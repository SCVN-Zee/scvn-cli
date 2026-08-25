/**
 * features/pack/bundle-paths.ts — Resolve the producer's source + output paths.
 *
 * `make pack` copies the install root's `bin/`, `dist/`, `templates/`, `catalog/`
 * plus the user's `~/.scvn/store/` into a staging dir, then zips it. This module
 * locates those sources (reusing the shared install-root walk) and computes the
 * archive name. The store dir name is imported from the bundled-store probe so
 * producer and consumer agree on the layout.
 */

import path from "node:path";
import { findInstallRoot } from "../../util/install-root.js";
import { getScvnDir } from "../../config/paths.js";
import { BUNDLED_STORE_DIRNAME } from "../store/bundled-store-paths.js";
import { userMcpCacheDir } from "../mcp/mcp-cache-paths.js";

/** CLI trees copied verbatim from the install root into a bundle. */
export const BUNDLE_CLI_TREES = ["bin", "dist", "templates"] as const;

export interface BundleSourcePaths {
  /** Install root (holds bin/, dist/, templates/). */
  installRoot: string;
  /** Built CLI entry — its absence means `npm run build` was not run. */
  cliEntry: string;
  /** Parent of the user store, so `syncSingleFolder(parent, staging, "store")` mirrors it. */
  userStoreParent: string;
  /** The user store itself (~/.scvn/store) — for size preview + emptiness check. */
  userStoreDir: string;
  /** The user MCP cache (~/.scvn/mcp) — the newest version dir + its CLI get bundled. */
  mcpCacheDir: string;
  /** Cache root for downloaded Node runtimes (~/.scvn/cache/node), shared across packs. */
  nodeCacheDir: string;
  /** Directory the archive is written to (gitignored `pkg/`). */
  outDir: string;
}

export interface ResolveBundlePathsOpts {
  /** Override the install root (tests). */
  installRootOverride?: string;
  /** Override the scvn home dir (~/.scvn) (tests). */
  scvnDirOverride?: string;
}

/**
 * Resolve every source/output path `pack` needs, or null when the install root
 * cannot be located (templates/ missing — should not happen for a real install).
 */
export async function resolveBundleSourcePaths(
  opts: ResolveBundlePathsOpts = {},
): Promise<BundleSourcePaths | null> {
  const installRoot = opts.installRootOverride ?? (await findInstallRoot());
  if (installRoot === null) return null;

  const scvnDir = getScvnDir(opts.scvnDirOverride);
  return {
    installRoot,
    cliEntry:        path.join(installRoot, "dist", "cli.mjs"),
    userStoreParent: scvnDir,
    userStoreDir:    path.join(scvnDir, BUNDLED_STORE_DIRNAME),
    mcpCacheDir:     userMcpCacheDir(opts.scvnDirOverride),
    nodeCacheDir:    path.join(scvnDir, "cache", "node"),
    outDir:          path.join(installRoot, "pkg"),
  };
}

/** Version-stamped archive path: `<outDir>/scvn-bundle-<version>.zip`. */
export function bundleArchivePath(outDir: string, version: string): string {
  return path.join(outDir, `scvn-bundle-${version}.zip`);
}
