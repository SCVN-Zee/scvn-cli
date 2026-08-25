/**
 * scripts/pack.ts — Maintainer build-and-bundle entry (replaces the old `scvn pack` command).
 *
 * Produces a self-contained deliverable: the built CLI (bin/dist/templates) + a copy of
 * ~/.scvn/store + a pinned Node runtime → pkg/scvn-bundle-<version>.zip. A teammate unzips it and
 * `scvn packages import` works with no source project AND no Node install. Run via the Makefile
 * (`make pack` / `make pack-no-node`) — it is a producer action, never a shipped user command.
 *
 * Non-interactive by design: no confirm, no dry-run. Fail-fast ordering mirrors the old flow —
 * locate install root → guard dist/cli.mjs → resolve arch → fetch+verify Node BEFORE any staging
 * (so a fetch/verify failure aborts with no temp dir, no zip) → assemble → zip. The temp staging
 * dir is always cleaned. `--no-node` skips the Node step (consumer needs a system Node ≥20).
 *
 * runPackBundle() returns an exit code (0 ok, 1 failed) so it is unit-testable; main() maps it to
 * process.exit only when this file is executed directly (not when imported by a test).
 */

import process from "node:process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, mkdir, rm, access, stat } from "node:fs/promises";
import { getVersion } from "../src/util/app-info.js";
import { duSize, formatBytes } from "../src/util/du-size.js";
import { shortenPath } from "../src/util/paths.js";
import { readPackagesStoreMeta } from "../src/features/store/index.js";
import { resolveBundleSourcePaths, bundleArchivePath } from "../src/features/pack/bundle-paths.js";
import { assembleBundle } from "../src/features/pack/assemble-bundle.js";
import { listVerDirs } from "../src/features/mcp/mcp-cache-paths.js";
import { createZip } from "../src/services/zip.js";
import {
  fetchNodeBinary,
  currentDarwinArch,
  PINNED_NODE_VERSION,
  type DarwinArch,
} from "../src/services/node-dist.js";

export interface PackBundleOpts {
  /** Skip bundling a Node runtime — the consumer must have a system Node ≥20. */
  noNode?: boolean;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the deliverable bundle. Returns 0 on success, 1 on any abort/failure.
 * Free of process.exit so tests can assert the code; progress goes to the console.
 */
export async function runPackBundle(opts: PackBundleOpts = {}): Promise<number> {
  const noNode = opts.noNode ?? false;

  const paths = await resolveBundleSourcePaths();
  if (paths === null) {
    console.error("pack: could not locate the scvn install root (templates/ missing)");
    return 1;
  }

  // Producer fail-fast: we ship the BUILT cli (dist/), not source.
  if (!(await pathExists(paths.cliEntry))) {
    console.error("pack: dist/cli.mjs not found — run `make build` first");
    return 1;
  }

  // Store provenance — tolerant of an empty store (mirrors import): a store with no staged
  // packages still bundles the CLI, but warn loudly so it is never silent.
  const packagesMeta = await readPackagesStoreMeta(paths.userStoreDir).catch(() => null);
  const hasPackages = Boolean(packagesMeta && packagesMeta.packages.length > 0);
  if (!hasPackages) {
    console.warn("pack: store is empty — the bundle will ship the CLI with no staged assets");
  }

  const version    = getVersion();
  const archive    = bundleArchivePath(paths.outDir, version);
  const storeBytes = await duSize(paths.userStoreDir);

  // Resolve the bundled-Node arch up front; currentDarwinArch throws only on a non-arm64/x64 host.
  let nodeArch: DarwinArch | undefined;
  if (!noNode) {
    try {
      nodeArch = currentDarwinArch();
    } catch (err) {
      console.error(`pack: ${(err as Error).message}`);
      console.error("pack: re-run `make pack-no-node` to build without a bundled Node.");
      return 1;
    }
  }

  // Fetch + verify the bundled Node BEFORE any staging, so a fetch/verify failure aborts cleanly
  // (no temp dir, no zip) and never lets a node-less bundle ship as success.
  let nodeBinPath: string | undefined;
  if (noNode) {
    console.warn("pack: --no-node — the bundle will require a system Node ≥20 on the consumer's machine");
  } else {
    try {
      nodeBinPath = await fetchNodeBinary({
        version:  PINNED_NODE_VERSION,
        arch:     nodeArch as DarwinArch,
        cacheDir: paths.nodeCacheDir,
      });
    } catch (err) {
      console.error(`pack: Node fetch failed: ${(err as Error).message}`);
      console.error("pack: re-run `make pack-no-node` to build without a bundled Node.");
      return 1;
    }
  }

  // The MCP cache is optional — a bundle without one still ships the CLI, it just
  // cannot vendor Unity-MCP offline. Warn, never fail (mirrors the empty store).
  const mcpVersions = await listVerDirs(paths.mcpCacheDir);
  const mcpBytes = await duSize(paths.mcpCacheDir);
  const mcpLine =
    mcpVersions[0] === undefined
      ? "mcp:     (empty — bundle cannot vendor Unity-MCP offline)"
      : `mcp:     V${mcpVersions[0]}  (${formatBytes(mcpBytes)} cached, newest only ships)`;
  if (mcpVersions[0] === undefined) {
    console.warn("pack: MCP cache is empty — run `scvn mcp install` to stage one first");
  }

  const nodeLine = noNode
    ? "node:    (skipped — --no-node)"
    : `node:    v${PINNED_NODE_VERSION} (${nodeArch}, ${formatBytes((await stat(nodeBinPath as string)).size)})`;
  console.log(
    [
      `Building scvn bundle v${version}`,
      nodeLine,
      `store:   ${shortenPath(paths.userStoreDir)}  (${formatBytes(storeBytes)})`,
      mcpLine,
      `archive: ${shortenPath(archive)}`,
    ].join("\n"),
  );

  const staging = await mkdtemp(path.join(os.tmpdir(), "scvn-pack-"));
  try {
    await assembleBundle({
      installRoot:     paths.installRoot,
      userStoreParent: paths.userStoreParent,
      mcpCacheDir:     paths.mcpCacheDir,
      stagingDir:      staging,
      version,
      nodeBinPath,
    });
    await mkdir(paths.outDir, { recursive: true });
    await createZip(staging, archive);
    const archiveBytes = await duSize(archive);
    console.log(`pack: bundle ready → ${shortenPath(archive)} (${formatBytes(archiveBytes)})`);
    return 0;
  } catch (err) {
    console.error(`pack: failed — ${(err as Error).message}`);
    return 1;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** CLI entry: parse the one supported flag and map the result to a process exit code. */
async function main(): Promise<void> {
  const noNode = process.argv.includes("--no-node");
  process.exit(await runPackBundle({ noNode }));
}

// Run only when executed directly (`tsx scripts/pack.ts`), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
