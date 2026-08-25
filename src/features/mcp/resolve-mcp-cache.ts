/**
 * features/mcp/resolve-mcp-cache.ts — The ONE authority on cache precedence.
 *
 *   read:  user ~/.scvn/mcp  →  CLI-bundled <install-root>/mcp  →  null
 *   write: always the user cache. A bundle is a read-only producer artifact.
 *
 * Every reader — status, install, update, doctor — routes through here. That is
 * not stylistic: the snapshot store shipped a bug where the command layer probed
 * the user dir and the handler probed the bundled one, so an import silently
 * split-brained. One resolver, or the same bug again.
 */

import path from "node:path";
import { access } from "node:fs/promises";
import { userMcpCacheDir, verDir, cliDir, listVerDirs, listCliDirs } from "./mcp-cache-paths.js";
import { bundledMcpRoot } from "./bundled-mcp-paths.js";
import { semverMax, compareVersions } from "./semver-compare.js";
import { skewedPkgs } from "./versions-json.js";

/** Which cache a path came from — callers surface "(bundled)" from this. */
export type McpCacheSource = "user" | "bundled";

export interface StagedVersion {
  version: string;
  source: McpCacheSource;
  dir: string;
}

export interface McpCacheOpts {
  /** Override the user cache root (tests). Defaults to ~/.scvn/mcp. */
  userCacheDir?: string;
}

export interface NewestStagedOpts extends McpCacheOpts {
  /**
   * Addons the caller intends to install. A version dir that recorded any of them
   * as NOT pinning its core is skipped — it could never install, so offering it as
   * the offline fallback just relocates the failure. Omitted = no filter.
   */
  wantAddons?: readonly string[];
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** The cache scvn WRITES fetched versions into. Never the bundle. */
export function writeCacheDir(opts: McpCacheOpts = {}): string {
  return opts.userCacheDir ?? userMcpCacheDir();
}

/** Where a staged core version lives, preferring the user cache. Null when nowhere. */
export async function resolveMcpVerDir(
  coreVersion: string,
  opts: McpCacheOpts = {},
): Promise<StagedVersion | null> {
  const user = verDir(coreVersion, writeCacheDir(opts));
  if (await exists(user)) return { version: coreVersion, source: "user", dir: user };

  const bundled = await bundledMcpRoot();
  if (bundled !== null) {
    const candidate = verDir(coreVersion, bundled);
    if (await exists(candidate)) {
      return { version: coreVersion, source: "bundled", dir: candidate };
    }
  }

  return null;
}

/**
 * Every staged version across both caches, newest-first. A version present in
 * both is reported once, as "user" — matching what resolveMcpVerDir would pick.
 */
export async function listStagedVersions(
  opts: McpCacheOpts = {},
): Promise<StagedVersion[]> {
  const userDir = writeCacheDir(opts);
  const staged = new Map<string, StagedVersion>();

  for (const version of await listVerDirs(userDir)) {
    staged.set(version, { version, source: "user", dir: verDir(version, userDir) });
  }

  const bundled = await bundledMcpRoot();
  if (bundled !== null) {
    for (const version of await listVerDirs(bundled)) {
      if (staged.has(version)) continue; // user wins
      staged.set(version, { version, source: "bundled", dir: verDir(version, bundled) });
    }
  }

  return [...staged.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Newest staged core version across both caches, or null. Powers the offline
 * fallback.
 *
 * `wantAddons` filters out version dirs that provably cannot serve those addons.
 * Without it the fallback happily returns a dir the install gate is guaranteed to
 * refuse — the newest staged version is exactly the one a skewed fetch leaves
 * behind, so it wins the sort every time.
 */
export async function newestStagedVersion(opts: NewestStagedOpts = {}): Promise<string | null> {
  const staged = await listStagedVersions(opts);

  const usable: string[] = [];
  for (const entry of staged) {
    if (opts.wantAddons !== undefined && (await skewedPkgs(entry.dir, opts.wantAddons)).length > 0) {
      continue;
    }
    usable.push(entry.version);
  }

  return semverMax(usable);
}

/**
 * The cached `unity-mcp-cli` at EXACTLY `version`. Prefers the user cache, falls
 * back to the bundle.
 */
export async function resolveUnityMcpCliDir(
  version: string,
  opts: McpCacheOpts = {},
): Promise<StagedVersion | null> {
  const user = cliDir(version, writeCacheDir(opts));
  if (await exists(user)) return { version, source: "user", dir: user };

  const bundled = await bundledMcpRoot();
  if (bundled !== null) {
    const candidate = cliDir(version, bundled);
    if (await exists(candidate)) return { version, source: "bundled", dir: candidate };
  }

  return null;
}

/**
 * The cached CLI to pair with `coreVersion`: the exact version if present, else
 * the newest cached one that does NOT EXCEED it.
 *
 * The CLI normally tracks core exactly, but npm can lag OpenUPM by a publish.
 * Insisting on an exact match would then mean a bundle carrying a perfectly good
 * `unity-mcp-cli-0.83.0` is invisible to a core-0.83.1 install — so the bundle
 * would ship no CLI at all, and `.mcp.json` would go unwritten on the one machine
 * with no network to fix it. Never take a NEWER client than the core, though:
 * that is the one pairing direction that can actually break.
 */
export async function resolveCliForCore(
  coreVersion: string,
  opts: McpCacheOpts = {},
): Promise<StagedVersion | null> {
  const exact = await resolveUnityMcpCliDir(coreVersion, opts);
  if (exact !== null) return exact;

  const userDir = writeCacheDir(opts);
  const candidates: Array<{ version: string; source: McpCacheSource; root: string }> = [
    ...(await listCliDirs(userDir)).map((version) => ({
      version,
      source: "user" as const,
      root: userDir,
    })),
  ];

  const bundled = await bundledMcpRoot();
  if (bundled !== null) {
    candidates.push(
      ...(await listCliDirs(bundled)).map((version) => ({
        version,
        source: "bundled" as const,
        root: bundled,
      })),
    );
  }

  const usable = candidates.filter(
    (entry) => compareVersions(entry.version, coreVersion) <= 0,
  );
  const best = semverMax(usable.map((entry) => entry.version));
  if (best === null) return null;

  // User cache wins a tie, matching resolveUnityMcpCliDir's precedence.
  const pick = usable.find((entry) => entry.version === best && entry.source === "user")
    ?? usable.find((entry) => entry.version === best)!;

  return { version: pick.version, source: pick.source, dir: cliDir(pick.version, pick.root) };
}

/** Absolute path to the CLI's entry script inside a resolved cli dir. */
export function cliEntryPath(cliDirPath: string): string {
  return path.join(cliDirPath, "bin", "unity-mcp-cli.js");
}
