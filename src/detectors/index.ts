/**
 * detectors/index.ts — Barrel export for all fork-setup detectors.
 */

export { detectBeyondCompare } from "./detect-beyond-compare.js";
export type { BeyondCompareResult } from "./detect-beyond-compare.js";
export { detectUnityVersions } from "./detect-unity-versions.js";
export type { UnityVersionInfo } from "./detect-unity-versions.js";
export { detectForkRunning } from "./detect-fork-running.js";
