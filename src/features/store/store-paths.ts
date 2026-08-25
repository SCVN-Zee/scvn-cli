/**
 * features/store/store-paths.ts — Filesystem layout of the snapshot store.
 *
 * ~/.scvn/store/
 * └── packages/{meta.json, <relPath mirrors>}
 *
 * Every helper accepts an optional store-root override for testing,
 * mirroring the dependency-injection pattern of config/paths.ts.
 */

import path from "node:path";
import { getScvnDir } from "../../config/paths.js";

/** Store root: ~/.scvn/store */
export function getStoreDir(override?: string): string {
  return override ?? path.join(getScvnDir(), "store");
}

/** Packages slot: ~/.scvn/store/packages */
export function getPackagesStoreDir(storeDir?: string): string {
  return path.join(getStoreDir(storeDir), "packages");
}

/** Packages provenance file: ~/.scvn/store/packages/meta.json */
export function getPackagesStoreMetaPath(storeDir?: string): string {
  return path.join(getPackagesStoreDir(storeDir), "meta.json");
}
