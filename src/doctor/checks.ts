/**
 * doctor/checks.ts — Registry of environment checks for `scvn doctor`.
 *
 * Each check exposes:
 *   id       — machine-readable identifier
 *   label    — human-readable name rendered in the doctor screen
 *   macOnly  — documentary flag (groups mac-specific checks for the registry tests); the runner
 *              does NOT auto-skip — each macOnly check self-guards in run()
 *   run()    — async fn returning { severity, detail? }
 *
 * A macOnly check returns macOnlySkipped() ({ severity: 'skipped', detail: 'macOS only — skipped' })
 * on non-darwin platforms so the runner can distinguish skipped from pass.
 */

import { execa } from "execa";
import { realpath, stat } from "node:fs/promises";
import { rsyncSupportsProgress2 } from "../services/rsync.js";
import { commandExists } from "../util/command-exists.js";
import { findInstallRoot } from "../util/install-root.js";
import { bundledNodeBinPath } from "../features/pack/bundled-node-paths.js";
import { detectBeyondCompare } from "../detectors/detect-beyond-compare.js";
import { detectUnityVersions } from "../detectors/detect-unity-versions.js";
import { detectForkRunning } from "../detectors/detect-fork-running.js";
import { checkMergespecfile } from "../lib/check-mergespecfile.js";
import {
  listStagedVersions,
  resolveCliForCore,
} from "../features/mcp/resolve-mcp-cache.js";
import { formatBytes } from "../util/format-bytes.js";
import {
  readPackagesStoreMeta,
  resolveEffectiveStoreDir,
} from "../features/store/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "pass" | "warn" | "fail" | "skipped";

export interface CheckResult {
  severity: Severity;
  detail?: string;
}

/** Optional context passed to every check's run() (currently: store-dir override). */
export interface CheckContext {
  storeOverride?: string;
}

export interface Check {
  id: string;
  label: string;
  macOnly?: boolean;
  run(ctx?: CheckContext): Promise<CheckResult>;
}

// ---------------------------------------------------------------------------
// Helper: guard macOnly checks on non-darwin platforms
// ---------------------------------------------------------------------------

function macOnlySkipped(): CheckResult {
  return { severity: "skipped", detail: "macOS only — skipped" };
}

/** Suffix tag for a non-user store source in the doctor store line. */
function storeSourceTag(source: string | undefined): string {
  if (source === "bundled")  return " (bundled)";
  if (source === "override") return " (override)";
  return "";
}

// ---------------------------------------------------------------------------
// Individual check implementations
// ---------------------------------------------------------------------------

async function checkRsync(): Promise<CheckResult> {
  const ok = await rsyncSupportsProgress2();
  if (ok) return { severity: "pass", detail: "rsync ≥ 3.1 found" };
  return {
    severity: "warn",
    detail: "rsync < 3.1 — progress bars use fallback. Install: brew install rsync",
  };
}

async function checkGit(): Promise<CheckResult> {
  const found = await commandExists("git");
  if (found) return { severity: "pass" };
  return { severity: "fail", detail: "git not found in PATH" };
}

/**
 * git-lfs is needed only for the optional `scvn git --lfs` op, so a missing
 * binary is a warn (informational), NOT a fail — it must not flip doctor's exit
 * code the way a missing git/node would.
 */
async function checkGitLfs(): Promise<CheckResult> {
  const found = await commandExists("git-lfs");
  if (found) return { severity: "pass" };
  return {
    severity: "warn",
    detail: "git-lfs not found — needed only for `scvn git --lfs`. Install: brew install git-lfs",
  };
}

async function checkNode(): Promise<CheckResult> {
  // Report the RUNNING runtime via process.version — NOT a PATH `node` spawn. On a no-Node Mac the
  // CLI runs on the bundled node; spawning `node` would throw ENOENT and falsely report a failure.
  const version = process.version; // e.g. "v24.16.0"
  const major = Number(version.replace(/^v/, "").split(".")[0]) || 0;
  const source = (await runningBundledNode()) ? "bundled" : "system";
  const detail = `${version} (${source})`;
  if (major >= 20) return { severity: "pass", detail };
  return { severity: "warn", detail: `${detail} — recommend ≥ v20` };
}

/** True when the running interpreter (process.execPath) IS the bundled node/bin/node. */
async function runningBundledNode(): Promise<boolean> {
  const root = await findInstallRoot();
  if (root === null) return false;
  try {
    const [running, bundled] = await Promise.all([
      realpath(process.execPath),
      realpath(bundledNodeBinPath(root)),
    ]);
    return running === bundled;
  } catch {
    return false;
  }
}

/**
 * macOS diagnostic: a bundle ships node/bin/node, but on a CPU-arch mismatch (or a quarantine block
 * on a locked-down Mac) it won't run and the launcher silently fell back to system Node. Surface
 * that so support can diagnose in one command. Absent (a dev checkout) → skipped.
 */
async function checkBundledNode(): Promise<CheckResult> {
  if (process.platform !== "darwin") return macOnlySkipped();
  const root = await findInstallRoot();
  if (root === null) return { severity: "skipped", detail: "no bundled node shipped" };
  const binPath = bundledNodeBinPath(root);

  let present = false;
  try {
    present = (await stat(binPath)).isFile();
  } catch {
    present = false;
  }
  if (!present) return { severity: "skipped", detail: "no bundled node shipped" };

  if (await runningBundledNode()) return { severity: "pass", detail: "bundled node in use" };

  // Present but we are NOT running it — probe whether it runs at all on this machine.
  try {
    await execa(binPath, ["--version"]);
    return { severity: "pass", detail: "bundled node present + runnable" };
  } catch {
    return {
      severity: "warn",
      detail: `bundled node present but unrunnable (wrong CPU arch or quarantine) — try: xattr -dr com.apple.quarantine ${root}`,
    };
  }
}

/**
 * Informational store status — never fails the run: an empty store is a
 * normal state (nothing exported yet), so severity is always "pass".
 */
async function checkStore(ctx?: CheckContext): Promise<CheckResult> {
  // Resolve the effective store (explicit override, else user, else CLI-bundled)
  // so doctor reports what an import would actually apply, labelling the source.
  // The override threads from `scvn doctor --store <dir>`.
  const override = ctx?.storeOverride;
  const packagesEff = await resolveEffectiveStoreDir("packages", { override }).catch(() => null);
  const packagesMeta = await readPackagesStoreMeta(packagesEff?.storeDir).catch(() => null);
  const packagesTag = storeSourceTag(packagesEff?.source);

  // Empty packages[] counts as nothing staged — same rule as the import flows.
  if (packagesMeta && packagesMeta.packages.length > 0) {
    const totalBytes = packagesMeta.packages.reduce((sum, p) => sum + p.bytes, 0);
    return {
      severity: "pass",
      detail: `packages: ${packagesMeta.packages.length} staged, ${formatBytes(totalBytes)}${packagesTag}`,
    };
  }
  return { severity: "pass", detail: "nothing staged (scvn packages add)" };
}

/**
 * Informational MCP-cache status — never fails the run. An empty cache is a
 * normal state on a fresh machine (nothing vendored yet), so the worst it
 * reports is a warn.
 */
async function checkMcpCache(): Promise<CheckResult> {
  const staged = await listStagedVersions().catch(() => []);

  if (staged.length === 0) {
    return { severity: "warn", detail: "nothing staged (scvn mcp install)" };
  }

  const newest = staged[0]!;
  const tag = newest.source === "bundled" ? " (bundled)" : "";
  const versions = staged.map((entry) => `V${entry.version}`).join(", ");

  // Without the CLI closure the cache can vendor source but not write .mcp.json —
  // worth flagging, because on an offline machine there is no way to fetch it.
  const cli = await resolveCliForCore(newest.version).catch(() => null);
  if (cli === null) {
    return {
      severity: "warn",
      detail: `${versions}${tag} — no unity-mcp-cli cached (.mcp.json cannot be written offline)`,
    };
  }

  return { severity: "pass", detail: `${versions}${tag} + unity-mcp-cli@${cli.version}` };
}

async function checkBeyondCompare(): Promise<CheckResult> {
  if (process.platform !== "darwin") return macOnlySkipped();
  const result = await detectBeyondCompare();
  if (result.found) return { severity: "pass", detail: result.path ?? undefined };
  return { severity: "fail", detail: "Beyond Compare not found at expected path" };
}

async function checkUnity(): Promise<CheckResult> {
  if (process.platform !== "darwin") return macOnlySkipped();
  const versions = await detectUnityVersions();
  if (versions.length > 0) {
    return {
      severity: "pass",
      detail: versions.map((unityVersion) => unityVersion.version).join(", "),
    };
  }
  return { severity: "warn", detail: "No Unity Hub editors found with UnityYAMLMerge" };
}

async function checkFork(): Promise<CheckResult> {
  if (process.platform !== "darwin") return macOnlySkipped();
  const running = await detectForkRunning();
  if (!running) return { severity: "pass", detail: "Fork not running" };
  return { severity: "warn", detail: "Fork is running — quit Fork before applying git config" };
}

async function checkMergespec(): Promise<CheckResult> {
  if (process.platform !== "darwin") return macOnlySkipped();
  // Find the first available Unity version's mergespec path
  const versions = await detectUnityVersions();
  if (versions.length === 0) {
    return { severity: "warn", detail: "No Unity editors found — cannot verify mergespecfile.txt" };
  }
  // Check the newest (first after sort) version's merge spec
  const newestVersion = versions[0];
  if (!newestVersion) return { severity: "warn", detail: "No Unity editors found" };
  const result = await checkMergespecfile(newestVersion.mergeSpecPath);
  if (result.ok) return { severity: "pass", detail: result.path };
  return { severity: "fail", detail: result.reason };
}

// ---------------------------------------------------------------------------
// Check registry (ordered for display)
// ---------------------------------------------------------------------------

export const CHECKS: Check[] = [
  { id: "rsync",     label: "rsync ≥ 3.1",           run: checkRsync },
  { id: "git",       label: "git present",            run: checkGit },
  { id: "git-lfs",   label: "git-lfs present",        run: checkGitLfs },
  { id: "node",      label: "Node ≥ 20",              run: checkNode },
  { id: "bundled-node", label: "Bundled Node",        macOnly: true, run: checkBundledNode },
  { id: "store",     label: "Store (~/.scvn/store)",  run: checkStore },
  { id: "mcp-cache", label: "MCP cache (~/.scvn/mcp)", run: checkMcpCache },
  { id: "beyond-compare", label: "Beyond Compare",         macOnly: true, run: checkBeyondCompare },
  { id: "unity",     label: "Unity Hub editors",      macOnly: true, run: checkUnity },
  { id: "fork",      label: "Fork not running",       macOnly: true, run: checkFork },
  { id: "mergespec", label: "mergespecfile.txt BC",   macOnly: true, run: checkMergespec },
];
