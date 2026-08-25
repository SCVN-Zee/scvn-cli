/**
 * features/store/index.ts — Barrel export for the snapshot store layer.
 */

export {
  getStoreDir,
  getPackagesStoreDir,
  getPackagesStoreMetaPath,
} from "./store-paths.js";

export type {
  PackagesStoreMeta,
  StagedPackage,
} from "./store-meta.js";
export {
  readPackagesStoreMeta,
  writePackagesStoreMeta,
  upsertPackagesStoreMeta,
  removePackagesStoreEntries,
} from "./store-meta.js";

export { formatPackageProvenance } from "./store-provenance.js";

export {
  resolveEffectiveStoreDir,
} from "./resolve-store-dir.js";
export type {
  EffectiveStore,
  StoreSource,
  StoreFeature,
  ResolveStoreOpts,
} from "./resolve-store-dir.js";

export {
  bundledStoreRoot,
  bundledStoreExists,
} from "./bundled-store-paths.js";
