/**
 * features/mcp/fetch-version.ts — Stage one core version (+ addons + ppx) into the cache.
 *
 * Internal: callers own the "is it already staged?" decision (see ensure-staged).
 * This always rebuilds.
 *
 * Every version is resolved, downloaded, and integrity-verified BEFORE anything
 * is published: the whole tree is built in a staging dir and renamed into place
 * at the end. A failed refresh therefore leaves the previously staged version
 * intact — the bash original deleted each package dir before re-extracting it,
 * so an interrupted re-stage there left the cache missing a package.
 *
 * Ports `fetch_version` (unity-mcp-localize.sh:437).
 */

import path from "node:path";
import { mkdtemp, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { OPENUPM_REGISTRY } from "./mcp-constants.js";
import { distOf, fetchPackument, TARBALL_TIMEOUT_MS } from "../../services/npm-registry.js";
import type { FetchPackumentOpts } from "../../services/npm-registry.js";
import { resolveVersions } from "./resolve-versions.js";
import type { ResolvedPackage } from "./resolve-versions.js";
import { verDir, pruneVerDirs } from "./mcp-cache-paths.js";
import { verifyIntegrity } from "./verify-tarball.js";
import { extractTarball } from "./extract-tarball.js";
import { applyTransforms } from "./apply-transforms.js";
import { writeVersionsJson } from "./versions-json.js";
import type { SyncReporter } from "../transfer/reporter.js";

/** Fetch a URL as bytes. Injectable so tests never touch the network. */
export type BinaryFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface FetchVersionOpts extends FetchPackumentOpts {
  /** Cache root to stage into — always the USER cache; a bundle is read-only. */
  cacheDir: string;
  dryRun?: boolean;
  /** Downloads the tarballs (defaults to global fetch). */
  fetchBinary?: BinaryFetch;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

function log(opts: FetchVersionOpts, message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level: "info", message });
}

function pinsOf(resolved: readonly ResolvedPackage[]): Record<string, boolean> {
  const pins: Record<string, boolean> = {};
  for (const pkg of resolved) {
    // core/ppx carry pin:null — a pin is only meaningful for an addon.
    if (pkg.pin !== null) pins[pkg.name] = pkg.pin;
  }
  return pins;
}

/** Download + verify one package's tarball, returning its bytes. Nothing touches disk here. */
async function downloadPackage(
  pkg: ResolvedPackage,
  opts: FetchVersionOpts,
): Promise<Buffer> {
  const label = `${pkg.name}@${pkg.version}`;
  const packument = await fetchPackument(OPENUPM_REGISTRY, pkg.name, opts);
  const dist = distOf(packument, pkg.version, pkg.name);

  if (!dist.tarball) throw new Error(`${label}: registry published no tarball URL`);

  const doFetch: BinaryFetch =
    opts.fetchBinary ??
    ((url) => fetch(url, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) }));
  // dist.tarball VERBATIM — OpenUPM 302s to download.openupm.com, and a
  // hand-built URL would both miss the redirect and invite host injection.
  const response = await doFetch(dist.tarball);
  if (!response.ok) {
    throw new Error(`${label}: tarball download failed (HTTP ${response.status})`);
  }

  const payload = Buffer.from(await response.arrayBuffer());
  verifyIntegrity(payload, dist.integrity, label);
  return payload;
}

/**
 * Stage `coreVersion` + `addons` + ppx into `<cacheDir>/Unity-MCP V<core>/`.
 * Overwrites an existing version dir; publishes atomically.
 */
export async function fetchVersion(
  coreVersion: string,
  addons: readonly string[],
  opts: FetchVersionOpts,
): Promise<ResolvedPackage[]> {
  // An empty version yields a `Unity-MCP V` dir and a `…--.tgz` download. That
  // happens whenever a caller swallows a failed version resolve, so refuse it at
  // the boundary rather than producing nonsense downstream.
  if (!coreVersion) {
    throw new Error("fetchVersion: empty core version (a failed version resolve was swallowed)");
  }

  // Resolve every version up front, so the map is complete before any download.
  const resolved = await resolveVersions(coreVersion, addons, opts);
  log(opts, `resolved: ${resolved.map((p) => `${p.name}@${p.version}`).join(", ")}`);

  const target = verDir(coreVersion, opts.cacheDir);

  if (opts.dryRun) {
    log(opts, `[dry-run] would stage ${resolved.length} packages → ${target}`);
    return resolved;
  }

  await mkdir(opts.cacheDir, { recursive: true });
  const staging = await mkdtemp(path.join(opts.cacheDir, ".stage-"));

  try {
    const tarballs = path.join(staging, ".tarballs");
    await mkdir(tarballs, { recursive: true });

    for (const pkg of resolved) {
      opts.reporter?.onStatus({ status: "running", detail: `${pkg.name}@${pkg.version}` });
      const payload = await downloadPackage(pkg, opts);

      // The pristine archive is kept as insurance: it is what a future transform
      // fix would re-extract from, without re-downloading.
      const tgz = path.join(tarballs, `${pkg.name}-${pkg.version}.tgz`);
      await writeFile(tgz, payload);

      const pkgDir = path.join(staging, pkg.name);
      await extractTarball(tgz, pkgDir);
      await applyTransforms(pkgDir, pkg.name, { reporter: opts.reporter });
    }

    await writeVersionsJson(staging, {
      core: coreVersion,
      packages: Object.fromEntries(resolved.map((pkg) => [pkg.name, pkg.version])),
      pins: pinsOf(resolved),
      fetchedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });

    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    log(opts, `staged → ${target}`);
    await pruneVerDirs(opts.cacheDir, coreVersion);
    return resolved;
  } catch (err) {
    // The previously staged version (if any) is untouched — only the staging dir dies.
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
