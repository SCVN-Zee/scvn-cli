/**
 * features/packages/index.ts — Barrel for the packages add/import/remove ops.
 */

export { resolveAddFolder } from "./resolve-add-folder.js";
export type { PackageSpec, ResolvedAddFolder, ResolveAddFolderResult } from "./resolve-add-folder.js";
export { exportPackages } from "./export-packages.js";
export type { ExportPackagesOpts } from "./export-packages.js";
export { importPackages } from "./import-packages.js";
export type { ImportPackagesOpts } from "./import-packages.js";
export { removePackages } from "./remove-packages.js";
export type { RemovePackagesOpts } from "./remove-packages.js";
