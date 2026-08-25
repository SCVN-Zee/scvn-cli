/**
 * features/mcp/resolve-versions.ts — Pick a concrete version for every package.
 *
 * Every version is resolved up front, before anything is written, so a version
 * dir is only ever created from a complete map.
 *
 * The addon PIN VERDICT is the subtle part. Addons declare an exact dependency
 * on one core version. Installing an addon that pins a different core compiles
 * fine and then fails at runtime as an opaque MCP tool error — so the verdict is
 * recorded here at fetch and enforced later at install (see pin-gate.ts).
 * Recording a skewed addon is fine; installing one is not.
 *
 * WHICH core to resolve against is not decided here — resolve-coherent-core.ts
 * solves that against the addon set, so a skewed verdict is now the exception
 * (an explicitly named version) rather than the default path's normal output.
 *
 * Ports `resolve_addon_ver` / `resolve_ppx_ver` / `pkg_version_map`
 * (unity-mcp-localize.sh:171-236).
 */

import {
  fetchPackument,
  latestVersion,
  dependenciesOf,
  allVersions,
} from "../../services/npm-registry.js";
import type { FetchPackumentOpts } from "../../services/npm-registry.js";
import { OPENUPM_REGISTRY, CORE_PKG, PPX_PKG } from "./mcp-constants.js";
import { semverMax } from "./semver-compare.js";
import type { SyncReporter } from "../transfer/reporter.js";

/** One resolved package. `pin` is null for core/ppx — a pin is only meaningful for an addon. */
export interface ResolvedPackage {
  name: string;
  version: string;
  /** true = declares this exact core; false = does not (install gate blocks it). */
  pin: boolean | null;
}

export interface ResolveOpts extends FetchPackumentOpts {
  reporter?: Pick<SyncReporter, "onLog">;
}

function warn(opts: ResolveOpts, message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level: "warn", message });
}

/**
 * The newest addon version that pins `coreVersion`. When none does, fall back to
 * the newest published version and record `pin: false` — staging it is allowed
 * (you may want to inspect it), installing it is not.
 */
export async function resolveAddonVersion(
  addon: string,
  coreVersion: string,
  opts: ResolveOpts = {},
): Promise<ResolvedPackage> {
  const packument = await fetchPackument(OPENUPM_REGISTRY, addon, opts);
  const versions = allVersions(packument);
  if (versions.length === 0) throw new Error(`registry publishes no versions of '${addon}'`);

  const pinning = versions.filter(
    (version) => dependenciesOf(packument, version)[CORE_PKG] === coreVersion,
  );

  const pinned = semverMax(pinning);
  if (pinned !== null) return { name: addon, version: pinned, pin: true };

  const newest = semverMax(versions)!;
  warn(
    opts,
    `no ${addon} version pins core ${coreVersion}; staging newest ${newest} ` +
      `(install will refuse it without --force)`,
  );
  return { name: addon, version: newest, pin: false };
}

/**
 * The PlayerPrefsEx version the core declares. Today that is an exact pin, which
 * is used as-is. A range means upstream loosened it — take the registry's latest
 * and say so, because an unverified range is exactly the kind of thing that
 * quietly changes what gets vendored.
 */
export async function resolvePpxVersion(
  coreVersion: string,
  opts: ResolveOpts = {},
): Promise<ResolvedPackage> {
  const corePackument = await fetchPackument(OPENUPM_REGISTRY, CORE_PKG, opts);
  const declared = dependenciesOf(corePackument, coreVersion)[PPX_PKG];

  const latestPpx = async (): Promise<string> => {
    const packument = await fetchPackument(OPENUPM_REGISTRY, PPX_PKG, opts);
    return latestVersion(packument, PPX_PKG);
  };

  if (!declared) {
    warn(opts, `core ${coreVersion} does not declare ${PPX_PKG}; falling back to registry latest`);
    return { name: PPX_PKG, version: await latestPpx(), pin: null };
  }

  if (/^\d/.test(declared)) {
    return { name: PPX_PKG, version: declared, pin: null };
  }

  warn(
    opts,
    `core declares ${PPX_PKG} range '${declared}'; picking registry latest (verify manually)`,
  );
  return { name: PPX_PKG, version: await latestPpx(), pin: null };
}

/**
 * The full package map for a core version: core + the requested addons + ppx.
 * Resolved atomically — a failure here means nothing was staged.
 */
export async function resolveVersions(
  coreVersion: string,
  addons: readonly string[],
  opts: ResolveOpts = {},
): Promise<ResolvedPackage[]> {
  const resolved: ResolvedPackage[] = [
    { name: CORE_PKG, version: coreVersion, pin: null },
  ];

  for (const addon of addons) {
    resolved.push(await resolveAddonVersion(addon, coreVersion, opts));
  }

  resolved.push(await resolvePpxVersion(coreVersion, opts));
  return resolved;
}
