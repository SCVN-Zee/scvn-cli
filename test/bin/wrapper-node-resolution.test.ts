/**
 * test/bin/wrapper-node-resolution.test.ts — bin/scvn three-tier Node resolution.
 *
 * Spawns the REAL bin/scvn against fake bundle layouts under tmp dirs with a controlled PATH, so
 * the bundled→system→onboard fall-through (and its exit codes) are exercised end-to-end. The
 * highest-blast-radius file in the repo — every command boots through it.
 *
 * Skipped off macOS (the wrapper uses macOS `xattr`; the bundle target is macOS). Two static
 * cross-checks (drift guard + layout literal) run everywhere.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, copyFile, chmod, readFile } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { PINNED_NODE_VERSION } from "../../src/services/node-dist.js";
import { BUNDLED_NODE_SUBPATH } from "../../src/features/pack/bundled-node-paths.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const isDarwin = process.platform === "darwin";

// ---------------------------------------------------------------------------
// Static cross-checks (platform-independent)
// ---------------------------------------------------------------------------

describe("bin scripts — static contracts", () => {
  it("_onboard-node.sh VER matches PINNED_NODE_VERSION (no pin drift)", async () => {
    const src = await readFile(path.join(REPO, "bin", "_onboard-node.sh"), "utf8");
    const m = src.match(/^VER="([^"]+)"/m);
    expect(m?.[1]).toBe(PINNED_NODE_VERSION);
  });

  it("bin/scvn hardcodes the BUNDLED_NODE_SUBPATH literal (producer/consumer agree)", async () => {
    const src = await readFile(path.join(REPO, "bin", "scvn"), "utf8");
    expect(src).toContain(BUNDLED_NODE_SUBPATH); // "node/bin/node"
  });
});

// ---------------------------------------------------------------------------
// Spawn matrix (macOS only)
// ---------------------------------------------------------------------------

interface BundleOpts {
  /** Script body for <root>/node/bin/node — omit to ship no bundled node. */
  bundledNode?: string;
  /** Script body for <root>/bin/_onboard-node.sh — omit to copy the real one. */
  onboard?: string;
}

async function buildBundle(opts: BundleOpts): Promise<string> {
  const root = await tmpDir("scvn-wrap-");
  await mkdir(path.join(root, "bin"), { recursive: true });
  await copyFile(path.join(REPO, "bin", "scvn"), path.join(root, "bin", "scvn"));
  await chmod(path.join(root, "bin", "scvn"), 0o755);

  const onboardDest = path.join(root, "bin", "_onboard-node.sh");
  if (opts.onboard !== undefined) await writeFile(onboardDest, opts.onboard);
  else await copyFile(path.join(REPO, "bin", "_onboard-node.sh"), onboardDest);
  await chmod(onboardDest, 0o755);

  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "dist", "cli.mjs"), "console.log('CLI_RAN');\n");

  if (opts.bundledNode !== undefined) {
    await mkdir(path.join(root, "node", "bin"), { recursive: true });
    await writeFile(path.join(root, "node", "bin", "node"), opts.bundledNode);
    await chmod(path.join(root, "node", "bin", "node"), 0o755);
  }
  return root;
}

/** Write an executable `node` into a fresh dir; return the dir (to place on PATH). */
async function fakeNodeDir(body: string): Promise<string> {
  const d = await tmpDir("scvn-fakenode-");
  await writeFile(path.join(d, "node"), body);
  await chmod(path.join(d, "node"), 0o755);
  return d;
}

function run(root: string, pathDirs: string[], env: Record<string, string> = {}) {
  return execa(path.join(root, "bin", "scvn"), ["--version"], {
    env: { PATH: [...pathDirs, "/usr/bin", "/bin"].join(":"), ...env },
    extendEnv: false, // controlled PATH only — the real test env has node; we must hide it
    reject: false,    // inspect exit codes ourselves
  });
}

const SH = (body: string) => `#!/bin/sh\n${body}\n`;
const NODE_V = (v: string) => SH(`case "$1" in --version) echo v${v};; *) echo USING_SYSTEM;; esac`);

describe.skipIf(!isDarwin)("bin/scvn resolution (macOS)", () => {
  it("tier 1: uses the bundled node when present + runnable", async () => {
    const root = await buildBundle({ bundledNode: SH("echo USING_BUNDLED") });
    const r = await run(root, []); // no node on PATH
    expect(r.stdout).toContain("USING_BUNDLED");
    expect(r.exitCode).toBe(0);
  });

  it("arch mismatch: bundled node fails --version → falls through to system node (no abort)", async () => {
    const root = await buildBundle({ bundledNode: SH("exit 1") });
    const nodeDir = await fakeNodeDir(NODE_V("20.0.0"));
    const r = await run(root, [nodeDir]);
    expect(r.stdout).toContain("USING_SYSTEM");
    expect(r.exitCode).toBe(0);
  });

  it("tier 2: uses a system node >= 20 when no bundle", async () => {
    const root = await buildBundle({});
    const nodeDir = await fakeNodeDir(NODE_V("22.1.0"));
    const r = await run(root, [nodeDir]);
    expect(r.stdout).toContain("USING_SYSTEM");
    expect(r.exitCode).toBe(0);
  });

  it("old system node (<20) → reaches onboarding (no premature set -e abort), propagates its exit", async () => {
    const marker = path.join(await tmpDir("scvn-marker-"), "ran");
    const root = await buildBundle({ onboard: SH('echo ran > "$SCVN_TEST_MARKER"\nexit 1') });
    const nodeDir = await fakeNodeDir(NODE_V("18.0.0"));
    const r = await run(root, [nodeDir], { SCVN_TEST_MARKER: marker });
    expect(r.exitCode).not.toBe(0);
    await expect(readFile(marker, "utf8")).resolves.toContain("ran"); // onboard actually ran
  });

  it("onboard success: re-resolves the printed path and execs it", async () => {
    const installed = await fakeNodeDir(SH("echo USING_INSTALLED"));
    const installedBin = path.join(installed, "node");
    const root = await buildBundle({ onboard: SH(`echo "${installedBin}"\nexit 0`) });
    const r = await run(root, []); // no node on PATH
    expect(r.stdout).toContain("USING_INSTALLED");
    expect(r.exitCode).toBe(0);
  });

  it("onboard 'success' but node still absent → guidance + exit 1, never execs a missing node", async () => {
    const root = await buildBundle({ onboard: SH('echo "/nope/does/not/exist/node"\nexit 0') });
    const r = await run(root, []); // no node on PATH, bogus installed path
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/new terminal/i);
    expect(r.stdout).not.toContain("CLI_RAN");
  });
});

// The REAL _onboard-node.sh's no-install gates — reachable without sudo/network because they
// short-circuit BEFORE any download (RT#5: never install unattended).
describe.skipIf(!isDarwin)("_onboard-node.sh non-install gates", () => {
  const onboard = path.join(REPO, "bin", "_onboard-node.sh");

  it("--yes → instructs + exit 1 (no prompt, no sudo, no network)", async () => {
    const r = await execa(onboard, ["--yes"], { reject: false });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/nodejs\.org/);
  });

  it("non-TTY stdin → instructs + exit 1", async () => {
    const r = await execa(onboard, [], { reject: false, input: "" }); // piped stdin = not a TTY
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/nodejs\.org/);
  });
});
