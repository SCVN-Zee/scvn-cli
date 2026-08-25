/**
 * features/mcp/npm-closure.ts — Materialize an npm package + its transitive deps.
 *
 * An npm tarball ships NO node_modules, so a fetched CLI would die at its first
 * bare `import` with ERR_MODULE_NOT_FOUND. This walks the `dependencies` graph
 * and lays every package out FLAT under one `node_modules/` — which is what
 * Node's resolver walks up to find, and what npm's hoisting produces.
 *
 * Flat layout can hold exactly one copy of a package, so a genuine version
 * conflict makes it unsound. That fails loudly here rather than shipping a
 * closure that explodes on the consumer's machine.
 */

import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import {
  fetchPackument,
  distOf,
  dependenciesOf,
  allVersions,
  TARBALL_TIMEOUT_MS,
} from "../../services/npm-registry.js";
import type { FetchPackumentOpts } from "../../services/npm-registry.js";
import { NPM_REGISTRY } from "./mcp-constants.js";
import { semverMax, caretSatisfies } from "./semver-compare.js";
import { verifyIntegrity } from "./verify-tarball.js";
import { extractTarball } from "./extract-tarball.js";
import type { BinaryFetch } from "./fetch-version.js";

export interface ClosureOpts extends FetchPackumentOpts {
  fetchBinary?: BinaryFetch;
}

/** Download, verify, and extract one npm package into `destDir`. */
export async function materializePackage(
  pkg: string,
  version: string,
  destDir: string,
  scratchDir: string,
  opts: ClosureOpts,
): Promise<void> {
  const label = `${pkg}@${version}`;
  const packument = await fetchPackument(NPM_REGISTRY, pkg, opts);
  const dist = distOf(packument, version, pkg);
  if (!dist.tarball) throw new Error(`${label}: registry published no tarball URL`);

  const doFetch: BinaryFetch =
    opts.fetchBinary ??
    ((url) => fetch(url, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) }));
  const response = await doFetch(dist.tarball);
  if (!response.ok) throw new Error(`${label}: download failed (HTTP ${response.status})`);

  const payload = Buffer.from(await response.arrayBuffer());
  verifyIntegrity(payload, dist.integrity, label);

  const tgz = path.join(scratchDir, `.dl-${pkg.replace(/[^\w.-]/g, "_")}.tgz`);
  await writeFile(tgz, payload);
  await extractTarball(tgz, destDir);
  await rm(tgz, { force: true });
}

/** Newest published version satisfying `range`, or throw naming both. */
function pickSatisfying(pkg: string, range: string, published: string[]): string {
  const pick = semverMax(published.filter((version) => caretSatisfies(range, version)));
  if (pick === null) {
    throw new Error(
      `offline closure: no published ${pkg} satisfies '${range}' — cannot resolve it`,
    );
  }
  return pick;
}

/**
 * Materialize the transitive closure of `rootDeps` into `<stagingDir>/node_modules/`.
 * Returns the resolved pkg → version map.
 */
export async function materializeClosure(
  rootDeps: Record<string, string>,
  stagingDir: string,
  opts: ClosureOpts,
): Promise<Record<string, string>> {
  const nodeModules = path.join(stagingDir, "node_modules");
  await mkdir(nodeModules, { recursive: true });

  const resolved: Record<string, string> = {};
  const queue = Object.entries(rootDeps).map(([pkg, range]) => ({ pkg, range }));

  while (queue.length > 0) {
    const { pkg, range } = queue.shift()!;

    const already = resolved[pkg];
    if (already !== undefined) {
      // A second dependent wants a version the installed copy cannot satisfy —
      // a flat node_modules cannot hold both, so hoisting is unsound here.
      if (!caretSatisfies(range, already)) {
        throw new Error(
          `offline closure: ${pkg}@${already} does not satisfy a second dependent's '${range}' — ` +
            `a flat node_modules cannot hold both versions`,
        );
      }
      continue;
    }

    const packument = await fetchPackument(NPM_REGISTRY, pkg, opts);
    const version = pickSatisfying(pkg, range, allVersions(packument));
    resolved[pkg] = version;

    await materializePackage(pkg, version, path.join(nodeModules, pkg), stagingDir, opts);

    for (const [dep, depRange] of Object.entries(dependenciesOf(packument, version))) {
      queue.push({ pkg: dep, range: depRange });
    }
  }

  return resolved;
}
