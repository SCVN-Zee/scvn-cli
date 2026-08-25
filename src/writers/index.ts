/**
 * writers/index.ts — Barrel export for all fork-setup writers.
 */

export { writeForkPrefs } from "./write-fork-prefs.js";
export type { ForkPrefsInput, ForkPrefsResult } from "./write-fork-prefs.js";
export { writeGitConfig, buildDriverArgs } from "./write-gitconfig.js";
export type { GitConfigInput, GitConfigResult } from "./write-gitconfig.js";
export {
  writeGitAttributes,
  loadUnityGitAttributesBlock,
} from "./write-gitattributes.js";
export type {
  GitAttrsInput,
  GitAttrsResult,
  GitAttrsPerProject,
} from "./write-gitattributes.js";
export {
  writeLfsAttributes,
  loadUnityLfsAttributesBlock,
  LFS_MARKER_BEGIN,
  LFS_MARKER_END,
} from "./write-lfs-attributes.js";
export type { LfsAttrsInput, LfsAttrsResult } from "./write-lfs-attributes.js";
