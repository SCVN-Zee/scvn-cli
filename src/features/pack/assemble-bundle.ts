/**
 * features/pack/assemble-bundle.ts — Stage a bundle's contents into a dir.
 *
 * Pure filesystem work (no zip, no process.exit) so it is unit-testable against
 * tmp dirs: copies the CLI trees (bin/dist/templates) from the install
 * root and the user store into `<staging>/store/`, then writes INSTALL.txt.
 * Reuses syncSingleFolder so the copy shares the same rsync + progress seam as
 * import.
 */

import path from "node:path";
import { writeFile, mkdir, access } from "node:fs/promises";
import { syncSingleFolder } from "../transfer/sync-single-folder.js";
import type { SyncReporter } from "../transfer/reporter.js";
import { noopReporter } from "../transfer/reporter.js";
import { BUNDLED_STORE_DIRNAME } from "../store/bundled-store-paths.js";
import { BUNDLE_CLI_TREES } from "./bundle-paths.js";
import { buildInstallText } from "./install-text.js";
import { stageNodeRuntime } from "./node-runtime-staging.js";
import { stageMcpCache } from "./mcp-cache-staging.js";

export interface AssembleBundleOpts {
  /** Install root holding bin/, dist/, templates/. */
  installRoot: string;
  /** Parent of the user store (~/.scvn); store mirrored from <parent>/store. */
  userStoreParent: string;
  /** Destination staging dir (created if missing). */
  stagingDir: string;
  /** Version for the INSTALL.txt header. */
  version: string;
  /** When set, stage this verified `bin/node` into `<staging>/node/bin/node`. */
  nodeBinPath?: string;
  /** When set, bundle the newest MCP version (+ its CLI) from this cache (~/.scvn/mcp). */
  mcpCacheDir?: string;
  reporter?: SyncReporter;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy bin/dist/templates + store/ + mcp/ into the staging dir and write
 * INSTALL.txt. Throws if any copy fails (the caller cleans the staging dir).
 */
export async function assembleBundle(opts: AssembleBundleOpts): Promise<void> {
  const reporter = opts.reporter ?? noopReporter;
  await mkdir(opts.stagingDir, { recursive: true });

  for (const tree of BUNDLE_CLI_TREES) {
    reporter.onStatus({ status: "running", detail: `staging ${tree}/…` });
    await syncSingleFolder(opts.installRoot, opts.stagingDir, tree, {
      onProgress: (progress) => reporter.onProgress(progress),
    });
  }

  // A producer who never ran `scvn packages export` has no ~/.scvn/store at all.
  // pack already WARNS that such a bundle ships no staged assets, so honor that
  // promise: ship an empty store rather than dying in rsync (exit 23) on a
  // source directory that was never created.
  reporter.onStatus({ status: "running", detail: `staging ${BUNDLED_STORE_DIRNAME}/…` });
  const storeSource = path.join(opts.userStoreParent, BUNDLED_STORE_DIRNAME);
  if (await pathExists(storeSource)) {
    await syncSingleFolder(opts.userStoreParent, opts.stagingDir, BUNDLED_STORE_DIRNAME, {
      onProgress: (progress) => reporter.onProgress(progress),
    });
  } else {
    await mkdir(path.join(opts.stagingDir, BUNDLED_STORE_DIRNAME), { recursive: true });
  }

  if (opts.mcpCacheDir) {
    await stageMcpCache({
      mcpCacheDir: opts.mcpCacheDir,
      stagingDir: opts.stagingDir,
      reporter,
    });
  }

  if (opts.nodeBinPath) {
    reporter.onStatus({ status: "running", detail: "staging node/…" });
    await stageNodeRuntime({ nodeBinPath: opts.nodeBinPath, stagingDir: opts.stagingDir });
  }

  await writeFile(
    path.join(opts.stagingDir, "INSTALL.txt"),
    buildInstallText(opts.version),
    "utf8",
  );
}
