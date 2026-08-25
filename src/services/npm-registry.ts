/**
 * services/npm-registry.ts — Read package metadata from an npm-protocol registry.
 *
 * OpenUPM (the Unity packages) and npm (`unity-mcp-cli`) return the same
 * packument shape, so one client parameterized by base URL serves both.
 *
 * Responses are cached per (registry, package) for the life of the process:
 * resolving core + addons + ppx reads the core packument several times, and the
 * registry state must not shift underneath a single resolve. Failures are NOT
 * cached — a transient 503 must not poison the run.
 *
 * `fetchImpl` is injectable so tests never touch the network.
 */

export { OPENUPM_REGISTRY, NPM_REGISTRY } from "../features/mcp/mcp-constants.js";

/** The `dist` block of one published version. */
export interface PackumentDist {
  /** `sha512-<base64>` — the integrity we verify a tarball against. */
  integrity?: string;
  /** Used VERBATIM. Never reconstruct it: OpenUPM 302s to another host. */
  tarball?: string;
}

export interface PackumentVersion {
  dist?: PackumentDist;
  dependencies?: Record<string, string>;
}

export interface Packument {
  "dist-tags"?: { latest?: string };
  versions?: Record<string, PackumentVersion>;
}

/** Minimal fetch shape this module needs (global `fetch` satisfies it). */
export type JsonFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchPackumentOpts {
  fetchImpl?: JsonFetch;
}

/**
 * Deadline for a metadata read, matching the bash original's `curl --max-time 60`.
 *
 * Node's global fetch has NO overall timeout. Without this, a machine behind a
 * captive portal or a black-holed route hangs for minutes behind a spinner
 * instead of falling through to the offline path — on exactly the machine the
 * offline path exists for.
 */
export const PACKUMENT_TIMEOUT_MS = 60_000;

/** Deadline for a tarball download (bash: `curl --max-time 120`). */
export const TARBALL_TIMEOUT_MS = 120_000;

const cache = new Map<string, Packument>();

/** @internal Drop the per-run packument cache (for tests). */
export function _resetPackumentCache(): void {
  cache.clear();
}

/** Fetch (and cache) a package's packument from `base`. */
export async function fetchPackument(
  base: string,
  pkg: string,
  opts: FetchPackumentOpts = {},
): Promise<Packument> {
  const key = `${base}/${pkg}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const doFetch: JsonFetch =
    opts.fetchImpl ?? ((url) => fetch(url, { signal: AbortSignal.timeout(PACKUMENT_TIMEOUT_MS) }));
  const response = await doFetch(key);
  if (!response.ok) {
    throw new Error(
      `registry fetch failed for '${pkg}': HTTP ${response.status} from ${base} — is it reachable?`,
    );
  }

  const packument = (await response.json()) as Packument;
  cache.set(key, packument);
  return packument;
}

/** `dist-tags.latest`, or throw naming the package. */
export function latestVersion(packument: Packument, pkg: string): string {
  const latest = packument["dist-tags"]?.latest;
  if (!latest) throw new Error(`registry has no dist-tags.latest for '${pkg}'`);
  return latest;
}

/** The `dist` block of one version, or throw naming the package and version. */
export function distOf(packument: Packument, version: string, pkg: string): PackumentDist {
  const dist = packument.versions?.[version]?.dist;
  if (!dist) throw new Error(`registry has no dist for '${pkg}@${version}'`);
  return dist;
}

/** A version's declared dependencies; `{}` when it declares none (or is absent). */
export function dependenciesOf(
  packument: Packument,
  version: string,
): Record<string, string> {
  return packument.versions?.[version]?.dependencies ?? {};
}

/** Every published version of a package. */
export function allVersions(packument: Packument): string[] {
  return Object.keys(packument.versions ?? {});
}
