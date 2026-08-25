/**
 * doctor/index.ts — Barrel export for the doctor module.
 */

export { CHECKS } from "./checks.js";
export type { Check, CheckResult, Severity } from "./checks.js";
export { run } from "./runner.js";
export type { CheckReport, RunnerResult } from "./runner.js";
