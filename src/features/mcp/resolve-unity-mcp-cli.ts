/**
 * features/mcp/resolve-unity-mcp-cli.ts — Cache `unity-mcp-cli` so it runs offline.
 *
 * `unity-mcp-cli` writes the project's `.mcp.json`, including a per-project MCP
 * port that is NOT derivable — reimplementing it was attempted and empirically
 * refuted (two different paths resolve to the same port). So the real tool has to
 * run, and on an artist's Mac it has to run with no network, no npx, and no npm.
 *
 * That is why the whole dependency closure is cached alongside it (see
 * npm-closure.ts): a bare CLI would die at its first `import chalk`.
 *
 * Invoked later via `process.execPath` — never `npx`, never a `node` from PATH.
 */

import { mkdtemp, mkdir, rm, rename } from "node:fs/promises";
import path from "node:path";
import { fetchPackument, allVersions, dependenciesOf } from "../../services/npm-registry.js";
import { NPM_REGISTRY, CLI_PKG } from "./mcp-constants.js";
import { cliDir, pruneCliDirs } from "./mcp-cache-paths.js";
import { resolveCliForCore } from "./resolve-mcp-cache.js";
import { semverMax, compareVersions } from "./semver-compare.js";
import { materializePackage, materializeClosure } from "./npm-closure.js";
import type { FetchVersionOpts } from "./fetch-version.js";

export interface CliClosureResult {
  /** Cache dir holding bin/, dist/, and the node_modules closure. */
  dir: string;
  version: string;
  /** True when nothing was fetched. */
  alreadyStaged: boolean;
}

export interface EnsureUnityMcpCliOpts extends FetchVersionOpts {
  /** Require a CLI exactly matching core when generating project config. */
  exact?: boolean;
}

class CliRegistryUnavailableError extends Error {
  constructor(cause: unknown) {
    super("unity-mcp-cli registry unavailable: " + String(cause));
    this.name = "CliRegistryUnavailableError";
  }
}

/**
 * The CLI version to pair with `coreVersion`. It normally tracks core exactly.
 * When it does not (publish lag), take the newest CLI that does NOT EXCEED core:
 * pairing an old core with a newer client is the one direction that can break.
 *
 * Unlike an addon pin, a mismatch here is not fatal — the CLI only writes
 * `.mcp.json`; it is never compiled into Unity.
 */
export async function resolveCliVersion(
  coreVersion: string,
  opts: FetchVersionOpts,
): Promise<string> {
  let packument: Awaited<ReturnType<typeof fetchPackument>>;
  try {
    packument = await fetchPackument(NPM_REGISTRY, CLI_PKG, opts);
  } catch (error) {
    throw new CliRegistryUnavailableError(error);
  }
  const published = allVersions(packument);

  if (published.includes(coreVersion)) return coreVersion;

  const notExceeding = published.filter((version) => compareVersions(version, coreVersion) <= 0);
  const pick = semverMax(notExceeding);
  if (pick === null) {
    throw new Error(
      `${CLI_PKG} publishes no version at or below core ${coreVersion} — cannot write .mcp.json`,
    );
  }

  opts.reporter?.onLog({
    ts: Date.now(),
    level: "warn",
    message: `${CLI_PKG} has no ${coreVersion}; using ${pick} (newest not exceeding core ${coreVersion})`,
  });
  return pick;
}

/**
 * Make sure `unity-mcp-cli` (paired to `coreVersion`) is cached with a complete
 * offline closure. Already cached → no network at all.
 */
export async function ensureUnityMcpCli(
  coreVersion: string,
  opts: EnsureUnityMcpCliOpts,
): Promise<CliClosureResult> {
  // Offline fast path, and it has to come FIRST. If a usable CLI is already
  const cached = await resolveCliForCore(coreVersion, { userCacheDir: opts.cacheDir });
  if (cached !== null && (!opts.exact || cached.version === coreVersion)) {
    return { dir: cached.dir, version: cached.version, alreadyStaged: true };
  }

  let version: string;
  if (opts.exact && cached !== null) {
    try {
      version = await resolveCliVersion(coreVersion, opts);
      if (version !== coreVersion) throw new Error("registry has no exact version");
    } catch (error) {
      if (!(error instanceof CliRegistryUnavailableError)) throw error;
      opts.reporter?.onLog({
        ts: Date.now(),
        level: "warn",
        message: "exact unity-mcp-cli is unavailable; using cached " + cached.version + " for offline compatibility (" + String(error) + ")",
      });
      return { dir: cached.dir, version: cached.version, alreadyStaged: true };
    }
  } else {
    // Nothing usable cached — ask the registry which version to pair with core.
    version = await resolveCliVersion(coreVersion, opts);
    if (opts.exact && version !== coreVersion) {
      throw new Error(CLI_PKG + " has no exact version for core " + coreVersion + "; refusing incompatible CLI " + version);
    }
  }
  const target = cliDir(version, opts.cacheDir);

  if (opts.dryRun) {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "info",
      message: `[dry-run] would cache ${CLI_PKG}@${version} + its offline closure → ${target}`,
    });
    return { dir: target, version, alreadyStaged: false };
  }

  await mkdir(opts.cacheDir, { recursive: true });
  const staging = await mkdtemp(path.join(opts.cacheDir, ".cli-stage-"));

  try {
    const packument = await fetchPackument(NPM_REGISTRY, CLI_PKG, opts);
    await materializePackage(CLI_PKG, version, staging, staging, opts);

    const closure = await materializeClosure(dependenciesOf(packument, version), staging, opts);
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "info",
      message:
        `cached ${CLI_PKG}@${version} with ${Object.keys(closure).length} bundled deps ` +
        `(${Object.keys(closure).sort().join(", ")})`,
    });

    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    await pruneCliDirs(opts.cacheDir, version);
    return { dir: target, version, alreadyStaged: false };
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
