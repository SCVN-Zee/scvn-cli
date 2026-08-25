/**
 * features/pack/mcp-cache-staging.ts — Stage the MCP cache into a bundle.
 *
 * Ships the NEWEST staged version dir plus the matching `unity-mcp-cli` closure
 * into `<staging>/mcp/`, which is exactly where `bundled-mcp-paths.ts` probes for
 * them on the consumer's machine. That pairing is what lets an artist with no
 * Node, no network, and no `~/.scvn/mcp` still run `scvn mcp install`.
 *
 * `.tarballs/` is excluded. It is fetch insurance for the producer — a pristine
 * archive to re-extract from — and nothing reads it at install time, so shipping
 * it would add ~800 KB to every bundle for no consumer benefit.
 *
 * Only the newest version ships. Offline ROLLBACK across versions needs those
 * versions staged locally, so it stays a dev-machine capability; a bundle user
 * has exactly one version by construction.
 */

import path from "node:path";
import { mkdir, cp, readdir } from "node:fs/promises";
import { BUNDLED_MCP_DIRNAME } from "../mcp/bundled-mcp-paths.js";
import { listVerDirs, listCliDirs, verDirName, cliDirName } from "../mcp/mcp-cache-paths.js";
import { semverMax, compareVersions } from "../mcp/semver-compare.js";
import { skewedPkgs } from "../mcp/versions-json.js";
import { shortAddonName } from "../mcp/addon-names.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface StageMcpCacheOpts {
  /** The producer's user cache (~/.scvn/mcp). */
  mcpCacheDir: string;
  /** Bundle staging dir (the dir that becomes the zip root). */
  stagingDir: string;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

export interface StageMcpCacheResult {
  /** The core version bundled, or null when the cache was empty. */
  version: string | null;
  /** True when a matching unity-mcp-cli closure shipped alongside it. */
  cliBundled: boolean;
}

/** Copy `<src>` → `<dest>`, skipping `.tarballs/`. */
async function copyVersionDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === ".tarballs") continue;
    await cp(path.join(src, entry.name), path.join(dest, entry.name), { recursive: true });
  }
}

/**
 * Stage the newest cached MCP version (+ its CLI) into `<staging>/mcp/`.
 * An empty cache is not an error — the bundle simply ships without one.
 */
export async function stageMcpCache(opts: StageMcpCacheOpts): Promise<StageMcpCacheResult> {
  const staged = await listVerDirs(opts.mcpCacheDir);
  const newest = await newestBundlableVersion(staged, opts);

  if (newest === undefined) {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "warn",
      message:
        staged.length === 0
          ? "MCP cache is empty — the bundle will ship without one (scvn mcp install to stage)"
          : "every staged MCP version has a skewed addon — the bundle will ship without one " +
            "(scvn mcp install to stage an installable version)",
    });
    return { version: null, cliBundled: false };
  }

  const mcpRoot = path.join(opts.stagingDir, BUNDLED_MCP_DIRNAME);
  await mkdir(mcpRoot, { recursive: true });

  opts.reporter?.onStatus({ status: "running", detail: `staging mcp/${verDirName(newest)}…` });
  await copyVersionDir(
    path.join(opts.mcpCacheDir, verDirName(newest)),
    path.join(mcpRoot, verDirName(newest)),
  );

  // The CLI is versioned independently of core and npm can lag OpenUPM by a
  // publish, so take the newest cached CLI that does not EXCEED core — never
  // just the exact match, or a one-publish lag ships a bundle with no CLI and
  // no way to write .mcp.json on a machine with no network to fix it.
  const cliVersion = await resolveBundledCliVersion(opts.mcpCacheDir, newest);
  let cliBundled = false;

  if (cliVersion !== null) {
    // Copied whole, node_modules included — a closure missing one dep is a
    // runtime ERR_MODULE_NOT_FOUND on the machine least able to fix it.
    await cp(
      path.join(opts.mcpCacheDir, cliDirName(cliVersion)),
      path.join(mcpRoot, cliDirName(cliVersion)),
      { recursive: true },
    );
    cliBundled = true;
  } else {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "warn",
      message: `no cached unity-mcp-cli at or below v${newest} — the bundle cannot write .mcp.json offline`,
    });
  }

  return { version: newest, cliBundled };
}

/**
 * Newest staged version the bundle can actually ship: the newest whose addons all
 * pin its core.
 *
 * "Newest" alone is not enough. A skewed fetch leaves the HIGHEST version dir in
 * the cache, so it wins the sort — and the bundle would ship the one version the
 * install gate is guaranteed to refuse, to the offline artist who has no network
 * to fix it and is the entire reason the bundle exists.
 */
async function newestBundlableVersion(
  staged: readonly string[],
  opts: StageMcpCacheOpts,
): Promise<string | undefined> {
  for (const version of staged) {
    const skewed = await skewedPkgs(path.join(opts.mcpCacheDir, verDirName(version)));
    if (skewed.length === 0) return version;

    opts.reporter?.onLog({
      ts: Date.now(),
      level: "warn",
      message:
        `not bundling V${version}: ${skewed.map(shortAddonName).join(", ")} do not pin it — ` +
        `an offline install would refuse it`,
    });
  }
  return undefined;
}

/** Newest cached CLI version not exceeding `coreVersion`, or null when none is cached. */
async function resolveBundledCliVersion(
  mcpCacheDir: string,
  coreVersion: string,
): Promise<string | null> {
  const cached = await listCliDirs(mcpCacheDir);
  return semverMax(cached.filter((version) => compareVersions(version, coreVersion) <= 0));
}
