/**
 * features/mcp/reconfigure-mcp.ts — `scvn mcp reconfigure`.
 *
 * Change an installed project's addon set atomically by reconciling `attachMcp`
 * to a newly solved want set. Inverse of install's domain: this verb REQUIRES
 * the project be installed (and names `install` when it is not).
 *
 * The version dir is a shared cache. Same-core bumps re-stage the UNION of
 * currently-staged addons and the requested set, so another project's cached
 * addons survive the atomic rm+rename in fetch-version.ts.
 */

import path from "node:path";
import { getRepoRoot } from "../../services/git.js";
import { toRealPath } from "../../util/real-path.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import { ADDON_NAMESPACE, CORE_PKG, PPX_PKG } from "./mcp-constants.js";
import { isInstalled, markerPackages } from "./marker.js";
import { resolveCoherentCore } from "./resolve-coherent-core.js";
import { resolveVersions } from "./resolve-versions.js";
import type { ResolvedPackage } from "./resolve-versions.js";
import { ensureStaged } from "./ensure-staged.js";
import { fetchVersion } from "./fetch-version.js";
import type { FetchVersionOpts } from "./fetch-version.js";
import { ensureUnityMcpCli } from "./resolve-unity-mcp-cli.js";
import { attachMcp } from "./attach-mcp.js";
import { resolveMcpVerDir } from "./resolve-mcp-cache.js";
import { readVersionsJson, centralPkgs } from "./versions-json.js";
import { compareVersions } from "./semver-compare.js";

export interface ReconfigureMcpOpts extends FetchVersionOpts {
  /** The project's Assets dir. */
  target: string;
  /** Addon package names (already expanded from the `--addons` CSV). */
  addons?: readonly string[];
  /** User's real force flag — never implied. Defaults false at the call site. */
  force?: boolean;
  /**
   * An explicit core version (the tab's chooser). Honored as-is — the pin-skew
   * gate in `attachMcp` still refuses an unsupported core unless `force`. Absent,
   * the coherent solve picks the newest core every addon supports.
   */
  coreVersion?: string;
  agent?: string;
}

function log(opts: ReconfigureMcpOpts, level: "info" | "warn", message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

/**
 * Same-core bumps skip `ensureStaged`'s presence-only fast path. Re-stage the
 * UNION of what is already cached and what this project wants, never just the
 * requested set — `fetchVersion` replaces the whole version dir.
 */
async function restageUnionIfStale(
  candidateCore: string,
  newAddons: readonly string[],
  resolved: readonly ResolvedPackage[],
  opts: ReconfigureMcpOpts,
): Promise<void> {
  const staged = await resolveMcpVerDir(candidateCore, { userCacheDir: opts.cacheDir });
  if (staged === null) return;

  const doc = await readVersionsJson(staged.dir);
  const stale = resolved.some((pkg) => {
    const current = doc.packages[pkg.name];
    return current === undefined || compareVersions(current, pkg.version) < 0;
  });
  if (!stale) return;

  const present = await centralPkgs(staged.dir);
  const currentlyStagedAddons = present.filter((pkg) => pkg.startsWith(ADDON_NAMESPACE));
  const union = [...new Set([...currentlyStagedAddons, ...newAddons])];

  log(
    opts,
    "info",
    `re-staging V${candidateCore} to refresh stale packages (union: ${union.join(", ")})`,
  );
  await fetchVersion(candidateCore, union, opts);
}

export async function reconfigureMcp(opts: ReconfigureMcpOpts): Promise<void> {
  const target = await toRealPath(opts.target);
  await assertUnityAssetsDir(target);
  const unityProjectDir = path.dirname(target);

  // 1. Domain guard — reconfigure owns installed projects only. Before network.
  if (!(await isInstalled(unityProjectDir))) {
    throw new Error(
      `${path.basename(unityProjectDir)} does not have MCP installed\n` +
        `  install it: scvn mcp install --target ${opts.target}`,
    );
  }

  // Default to the marker's CURRENT set, never the seed: an unspecified
  // reconfigure (e.g. `-y` with no --addons) must preserve the installed addons,
  // not silently shrink them to DEFAULT_ADDONS.
  const newAddons =
    opts.addons ??
    (await markerPackages(unityProjectDir)).filter((p) => p !== CORE_PKG && p !== PPX_PKG);
  // Narrow the solve: `force` on resolveCoherentCore would accept a conflict,
  // and reconfigure's force flag is only the editor + pin-skew escape hatch.
  const solveOpts = { fetchImpl: opts.fetchImpl, reporter: opts.reporter };
  const candidateCore = opts.coreVersion ?? (await resolveCoherentCore(newAddons, solveOpts));
  const resolved = await resolveVersions(candidateCore, newAddons, solveOpts);
  const want = [CORE_PKG, ...newAddons, PPX_PKG];

  log(
    opts,
    "info",
    `reconfigure ${path.basename(unityProjectDir)}: ${want.length} packages at v${candidateCore}`,
  );

  // 2a. Presence-union stage (offline-safe for already-cached addons).
  await ensureStaged(candidateCore, newAddons, opts);
  // 2b. Version-aware refresh — only when a target package is stale.
  await restageUnionIfStale(candidateCore, newAddons, resolved, opts);

  const staged = await resolveMcpVerDir(candidateCore, { userCacheDir: opts.cacheDir });
  if (staged === null) {
    if (opts.dryRun) {
      log(opts, "info", `[dry-run] V${candidateCore} is not staged; a real run would fetch it, then`);
      log(opts, "info", `[dry-run]   reconcile-attach ${want.length} packages`);
      opts.reporter?.onStatus({
        status: "done",
        detail: `would reconfigure to v${candidateCore}`,
      });
      return;
    }
    throw new Error(`V${candidateCore} could not be staged — inspect ${opts.cacheDir}`);
  }

  await ensureUnityMcpCli(candidateCore, opts).catch((err: unknown) => {
    log(opts, "warn", `unity-mcp-cli unavailable (${err instanceof Error ? err.message : String(err)}) — .mcp.json will be generated by the lifecycle runner if the CLI becomes available`);
    return null;
  });

  // 3. Reconcile to the NEW want. force is the user's flag, default false —
  // the editor gate and pin-skew gate stay intact.
  await attachMcp({
    repoRoot: await getRepoRoot(target),
    unityProjectDir,
    verDirPath: staged.dir,
    coreVersion: candidateCore,
    want,
    force: opts.force,
    dryRun: opts.dryRun,
    reporter: opts.reporter,
  });


  opts.reporter?.onStatus({
    status: "done",
    detail: opts.dryRun
      ? `would reconfigure ${want.length} packages (v${candidateCore})`
      : `reconfigured ${want.length} packages (v${candidateCore})`,
  });
}
