/**
 * config/index.ts — Barrel export for the scvn config module.
 */

export type { ScvnConfig } from "./types.js";
export {
  getScvnDir,
  getConfigPath,
  getHistoryPath,
  getPreviousScvnDir,
  getLegacyConfigPath,
} from "./paths.js";
export { loadConfig, parseConfigText } from "./load.js";
export type { LoadConfigOptions } from "./load.js";
export { saveConfig, quoteShell } from "./save.js";
export type { SaveConfigOptions } from "./save.js";
export { migrate } from "./migrate.js";
export type { MigrateOptions } from "./migrate.js";
