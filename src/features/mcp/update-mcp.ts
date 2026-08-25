/**
 * features/mcp/update-mcp.ts — `scvn mcp update [<coreVer>]`.
 *
 * Bumps an installed project, carrying the exact package set from its marker.
 * An OLDER `<coreVer>` is a rollback — it re-fetches that version from the
 * registry (the cache keeps only the latest), so a rollback needs the network.
 *
 * Two refusals define this verb:
 *
 *   - An UNINSTALLED project is refused, naming `install`. install and update own
 *     disjoint domains; neither ever silently does the other's job.
 *
 *   - A bare `update` with the registry unreachable FAILS. It does NOT fall back
 *     to the newest local version the way install does. That asymmetry is
 *     deliberate: install's job is "get me working", so using a perfectly good
 *     cache is right; update's job is "move me forward", and a bump that silently
 *     resolves BACKWARDS is worse than an error. Rollback stays explicit.
 *
 * `--addons` is warn-ignored: the marker is the lockfile. Changing the addon set
 * is an uninstall followed by an install.
 *
 * Ports `cmd_update` (unity-mcp-localize.sh:867).
 */

import path from "node:path";
import { getRepoRoot } from "../../services/git.js";
import { toRealPath } from "../../util/real-path.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import { CORE_PKG, PPX_PKG } from "./mcp-constants.js";
import { isInstalled, markerVersion, markerPackages } from "./marker.js";
import { resolveCoherentCore, NoCoherentCoreError } from "./resolve-coherent-core.js";
import { ensureStaged } from "./ensure-staged.js";
import { ensureUnityMcpCli } from "./resolve-unity-mcp-cli.js";
import { attachMcp } from "./attach-mcp.js";
import { invokeSetupMcp } from "./invoke-setup-mcp.js";
import { resolveMcpVerDir } from "./resolve-mcp-cache.js";
import type { FetchVersionOpts } from "./fetch-version.js";

export interface UpdateMcpOpts extends FetchVersionOpts {
  /** The project's Assets dir. */
  target: string;
  /**
   * Target core version. Omitted → the newest core the marker's addons can run
   * (and the registry must be reachable).
   */
  coreVersion?: string;
  /** Warn-ignored — the marker is the lockfile. */
  addons?: readonly string[];
  force?: boolean;
}

function log(opts: UpdateMcpOpts, level: "info" | "warn", message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

/**
 * The version to move to: the newest core the marker's addons can actually run.
 *
 * A bare update REQUIRES the registry: falling back to the newest local copy could
 * resolve backwards and silently downgrade. A NoCoherentCoreError is rethrown
 * as-is — it names a real conflict, and dressing it up as "cannot reach the
 * registry" would send the reader to check their network for nothing.
 */
async function resolveTargetVersion(
  opts: UpdateMcpOpts,
  addons: readonly string[],
): Promise<string> {
  if (opts.coreVersion) return opts.coreVersion;

  try {
    return await resolveCoherentCore(addons, opts);
  } catch (err: unknown) {
    if (err instanceof NoCoherentCoreError) throw err;
    throw new Error(
      `cannot resolve the latest core version (${err instanceof Error ? err.message : String(err)}).\n` +
        `  update never falls back to a local version — that could silently downgrade you.\n` +
        `  To roll back deliberately, name the version: scvn mcp update <coreVer>`,
    );
  }
}

export async function updateMcp(opts: UpdateMcpOpts): Promise<void> {
  const target = await toRealPath(opts.target);
  await assertUnityAssetsDir(target);
  const unityProjectDir = path.dirname(target);

  // 1. Domain guard — update owns installed projects only.
  if (!(await isInstalled(unityProjectDir))) {
    throw new Error(
      `${path.basename(unityProjectDir)} does not have MCP installed\n` +
        `  install it: scvn mcp install --target ${opts.target}`,
    );
  }

  if (opts.addons !== undefined) {
    log(
      opts,
      "warn",
      "--addons ignored by update: the marker is the lockfile " +
        "(to change the addon set: uninstall, then install with --addons)",
    );
  }

  // 2. The marker names both the current core AND the exact set to carry forward.
  const oldCore = await markerVersion(unityProjectDir);
  if (oldCore === null) {
    throw new Error(`marker has no coreVersion — inspect ${unityProjectDir}`);
  }
  const want = await markerPackages(unityProjectDir);
  if (want.length === 0) {
    throw new Error(`marker records no packages — inspect ${unityProjectDir}`);
  }

  // The marker's addons both constrain which core we can move to and are the set
  // staged at it — so they are resolved once, here, and used for both.
  const addons = want.filter((pkg) => pkg !== CORE_PKG && pkg !== PPX_PKG);
  const nextCore = await resolveTargetVersion(opts, addons);

  // 3. Same version → nothing to do. Writes nowhere, not even the cache.
  if (nextCore === oldCore && !opts.force) {
    log(opts, "info", `already at v${nextCore} — nothing to do (--force to re-import)`);
    opts.reporter?.onStatus({ status: "done", detail: `already at v${nextCore}` });
    return;
  }

  log(opts, "info", `update ${path.basename(unityProjectDir)}: v${oldCore} → v${nextCore}`);

  // 4. Stage the marker's package set at the target version. Already staged (a
  // rollback) → this touches the network zero times.
  await ensureStaged(nextCore, addons, opts);

  const staged = await resolveMcpVerDir(nextCore, { userCacheDir: opts.cacheDir });
  if (staged === null) {
    // A dry-run stages nothing, so an unstaged target has nothing to attach to.
    // Say so honestly rather than dying on a version a real run would have created.
    if (opts.dryRun) {
      log(opts, "info", `[dry-run] V${nextCore} is not staged; a real run would fetch it, then`);
      log(opts, "info", `[dry-run]   reconcile-attach ${want.length} packages`);
      opts.reporter?.onStatus({ status: "done", detail: `would update to v${nextCore}` });
      return;
    }
    throw new Error(`V${nextCore} could not be staged — inspect ${opts.cacheDir}`);
  }

  const cli = await ensureUnityMcpCli(nextCore, opts).catch(() => null);

  // 5. The same reconcile-attach path install uses.
  await attachMcp({
    repoRoot: await getRepoRoot(target),
    unityProjectDir,
    verDirPath: staged.dir,
    coreVersion: nextCore,
    want,
    force: opts.force,
    dryRun: opts.dryRun,
    reporter: opts.reporter,
  });

  if (cli !== null) {
    await invokeSetupMcp({
      unityProjectDir,
      cliVersion: cli.version,
      cacheDir: opts.cacheDir,
      dryRun: opts.dryRun,
      reporter: opts.reporter,
    });
  }

  log(opts, "info", `rollback: scvn mcp update ${oldCore} --target ${opts.target}`);
  opts.reporter?.onStatus({
    status: "done",
    detail: opts.dryRun
      ? `would update v${oldCore} → v${nextCore}`
      : `updated v${oldCore} → v${nextCore}`,
  });
}
