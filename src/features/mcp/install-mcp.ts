/**
 * features/mcp/install-mcp.ts — `scvn mcp install`.
 *
 * Vendor Unity-MCP into a project as Assets/ source, then have unity-mcp-cli
 * write the project's `.mcp.json`.
 *
 * install and update own DISJOINT domains, decided by the marker: install
 * refuses an already-installed project (and names `update`), update refuses one
 * that is not (and names `install`). Neither ever silently does the other's job.
 *
 * The domain guard runs FIRST — before any version resolution or network — so an
 * already-installed project is told exactly that, rather than something
 * incidental about the registry being unreachable.
 *
 * Ports `cmd_install` (unity-mcp-localize.sh:938).
 */

import path from "node:path";
import { getRepoRoot } from "../../services/git.js";
import { toRealPath } from "../../util/real-path.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import { DEFAULT_ADDONS, CORE_PKG, PPX_PKG } from "./mcp-constants.js";
import { isInstalled, markerVersion, markerPackages } from "./marker.js";
import { resolveInstallVersion } from "./resolve-install-ver.js";
import { ensureStaged } from "./ensure-staged.js";
import { ensureUnityMcpCli } from "./resolve-unity-mcp-cli.js";
import { attachMcp } from "./attach-mcp.js";
import { invokeSetupMcp } from "./invoke-setup-mcp.js";
import { resolveMcpVerDir } from "./resolve-mcp-cache.js";
import { centralPkgs } from "./versions-json.js";
import type { FetchVersionOpts } from "./fetch-version.js";

export interface InstallMcpOpts extends FetchVersionOpts {
  /** The project's Assets dir. */
  target: string;
  /**
   * Explicit core version. Otherwise resolved: the newest core the addon set can
   * actually run → newest usable staged (offline). An explicit version skips the
   * solve, so the install gate is what stands between it and a skewed vendor.
   */
  coreVersion?: string;
  /** Addon package names (already expanded from the `--addons` CSV). */
  addons?: readonly string[];
  /**
   * True when the user TYPED `--addons`. Then the set is a requirement: it must
   * be staged or the install fails. A set that merely came from the default seed
   * or the interactive picker is a preference, and degrades to what is cached
   * rather than failing — which is what an offline machine needs.
   */
  addonsRequired?: boolean;
  force?: boolean;
}

/**
 * The exact package set to install.
 *
 * Three sources, in order of authority:
 *
 *   1. The MARKER, when the project is already attached (only reachable with
 *      --force). It is the lockfile; changing the addon set is uninstall + install.
 *   2. --addons, when named — intersected with what is actually staged, so a
 *      package the cache lacks is never claimed.
 *   3. Otherwise, EVERYTHING the version dir staged. A bundle carries exactly
 *      what its producer chose, and a consumer who named no addons should get
 *      that — not a hardcoded seed that might both miss what shipped and demand
 *      what did not.
 */
async function resolveWantSet(
  unityProjectDir: string,
  verDirPath: string,
  addons: readonly string[] | undefined,
  opts: InstallMcpOpts,
): Promise<string[]> {
  if (await isInstalled(unityProjectDir)) {
    if (addons !== undefined) {
      opts.reporter?.onLog({
        ts: Date.now(),
        level: "warn",
        message:
          "--addons ignored: this project is already installed and its marker is the lockfile " +
          "(uninstall first to change the addon set)",
      });
    }
    const fromMarker = await markerPackages(unityProjectDir);
    if (fromMarker.length > 0) return fromMarker;
  }

  const staged = await centralPkgs(verDirPath);
  if (addons === undefined) return staged;

  return [CORE_PKG, ...addons, PPX_PKG].filter((pkg) => staged.includes(pkg));
}

export async function installMcp(opts: InstallMcpOpts): Promise<void> {
  // Symlink-resolve so the project path compares like-for-like with the root git
  // reports; otherwise the fence patterns and the porcelain pathspec are garbage.
  const target = await toRealPath(opts.target);
  await assertUnityAssetsDir(target);
  const unityProjectDir = path.dirname(target);
  const repoRoot = await getRepoRoot(target);

  // 0. Domain guard — before ANY network. An installed project is told so.
  if ((await isInstalled(unityProjectDir)) && !opts.force) {
    const current = await markerVersion(unityProjectDir);
    throw new Error(
      `${path.basename(unityProjectDir)} already has MCP installed (v${current ?? "?"})\n` +
        `  bump it:    scvn mcp update --target ${opts.target}\n` +
        `  reinstall:  scvn mcp install --target ${opts.target} --force`,
    );
  }

  // 1. Version + cache.
  //
  // The addon set constrains the version CHOICE, so it is the same set step 2
  // stages — otherwise we would solve for one set and then fetch another.
  const wantAddons = opts.addons ?? DEFAULT_ADDONS;
  const coreVersion = await resolveInstallVersion(opts.coreVersion, wantAddons, {
    ...opts,
    userCacheDir: opts.cacheDir,
  });

  // Top up the cache — but only insist when the user actually asked.
  //
  // A bundle carries whatever its producer staged. Topping that up against the
  // default seed would try to FETCH the difference, on the one machine that has
  // no network — which is the entire audience for a bundle. So a preference
  // (the seed, or an accepted picker default) degrades to what is cached, while
  // a typed --addons stays a hard requirement.
  const alreadyStaged = await resolveMcpVerDir(coreVersion, { userCacheDir: opts.cacheDir });
  if (alreadyStaged === null) {
    await ensureStaged(coreVersion, wantAddons, opts);
  } else if (opts.addons !== undefined) {
    try {
      await ensureStaged(coreVersion, opts.addons, opts);
    } catch (err: unknown) {
      if (opts.addonsRequired) throw err;
      opts.reporter?.onLog({
        ts: Date.now(),
        level: "warn",
        message:
          `could not stage every selected addon (${err instanceof Error ? err.message : String(err)}) — ` +
          `installing the packages already cached for v${coreVersion}`,
      });
    }
  }

  const staged = await resolveMcpVerDir(coreVersion, { userCacheDir: opts.cacheDir });
  if (staged === null) {
    if (opts.dryRun) {
      opts.reporter?.onLog({
        ts: Date.now(),
        level: "info",
        message: `[dry-run] V${coreVersion} is not staged; a real run would fetch it, then vendor it`,
      });
      return;
    }
    throw new Error(`V${coreVersion} could not be staged — inspect ${opts.cacheDir}`);
  }

  const want = await resolveWantSet(unityProjectDir, staged.dir, opts.addons, opts);

  // 2. The CLI that writes .mcp.json — cached now so the attach is the last
  // thing that can fail against the project tree.
  const cli = await ensureUnityMcpCli(coreVersion, opts).catch((err: unknown) => {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "warn",
      message: `unity-mcp-cli unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
        `vendoring will still complete; .mcp.json will not be written`,
    });
    return null;
  });

  // 3. The mutating path.
  await attachMcp({
    repoRoot,
    unityProjectDir,
    verDirPath: staged.dir,
    coreVersion,
    want,
    force: opts.force,
    dryRun: opts.dryRun,
    reporter: opts.reporter,
  });

  // 4. .mcp.json — a failure here WARNs: the vendoring already succeeded, and
  // this is the one re-runnable part.
  if (cli !== null) {
    await invokeSetupMcp({
      unityProjectDir,
      cliVersion: cli.version,
      cacheDir: opts.cacheDir,
      dryRun: opts.dryRun,
      reporter: opts.reporter,
    });
  }

  opts.reporter?.onStatus({
    status: "done",
    detail: opts.dryRun
      ? `would vendor ${want.length} packages (v${coreVersion})`
      : `vendored ${want.length} packages (v${coreVersion})`,
  });
}
