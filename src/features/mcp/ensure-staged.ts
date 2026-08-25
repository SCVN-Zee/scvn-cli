/**
 * features/mcp/ensure-staged.ts — Guarantee the cache carries a version + a package set.
 *
 * Idempotent. The fast path — everything already staged — touches the network
 * ZERO times, which is what lets a bundled cache install with no network at all.
 *
 * The UNION is the subtle part. Several repos install different subsets of one
 * staged version dir, so re-staging to add an addon must carry the addons already
 * there — otherwise adding `timeline` to repo B would silently strip `animation`
 * out from under repo A, which shares the same version dir.
 *
 * Ports `ensure_staged` (unity-mcp-localize.sh:495).
 */

import { CORE_PKG, PPX_PKG } from "./mcp-constants.js";
import { fetchVersion } from "./fetch-version.js";
import type { FetchVersionOpts } from "./fetch-version.js";
import { resolveMcpVerDir } from "./resolve-mcp-cache.js";
import { centralPkgs, hasVersionsJson } from "./versions-json.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface EnsureStagedOpts extends FetchVersionOpts {
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

export interface EnsureStagedResult {
  /** The version dir now backing this core version. */
  dir: string;
  /** True when nothing was fetched — the offline fast path. */
  alreadyStaged: boolean;
}

/**
 * Make sure `coreVersion` is staged with at least `addons` (plus core + ppx).
 * Fetches only what is missing; never removes an addon another repo installed.
 */
export async function ensureStaged(
  coreVersion: string,
  addons: readonly string[],
  opts: EnsureStagedOpts,
): Promise<EnsureStagedResult> {
  if (!coreVersion) throw new Error("ensureStaged: empty core version");

  // Read through the shared resolver: a bundled version counts as staged, which
  // is exactly how an artist with no ~/.scvn/mcp installs offline.
  const staged = await resolveMcpVerDir(coreVersion, { userCacheDir: opts.cacheDir });

  if (staged === null || !(await hasVersionsJson(staged.dir))) {
    await fetchVersion(coreVersion, addons, opts);
    const fetched = await resolveMcpVerDir(coreVersion, { userCacheDir: opts.cacheDir });
    // A dry run stages nothing, so there may still be no dir — callers preview and stop.
    return { dir: fetched?.dir ?? "", alreadyStaged: false };
  }

  const present = await centralPkgs(staged.dir);
  const missing = addons.filter((addon) => !present.includes(addon));
  if (missing.length === 0) {
    return { dir: staged.dir, alreadyStaged: true }; // fast path — no network
  }

  // Re-stage with the union of what is already there and what is being added.
  const existingAddons = present.filter((pkg) => pkg !== CORE_PKG && pkg !== PPX_PKG);
  const union = [...new Set([...existingAddons, ...missing])];

  opts.reporter?.onLog({
    ts: Date.now(),
    level: "info",
    message: `re-staging V${coreVersion} to add: ${missing.join(", ")}`,
  });

  await fetchVersion(coreVersion, union, opts);
  const refreshed = await resolveMcpVerDir(coreVersion, { userCacheDir: opts.cacheDir });
  return { dir: refreshed?.dir ?? staged.dir, alreadyStaged: false };
}
