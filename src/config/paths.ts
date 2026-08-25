/**
 * config/paths.ts — Resolves filesystem paths for scvn config files.
 *
 * Accepts optional overrides for dependency injection in tests.
 */

import { homedir } from "node:os";
import path from "node:path";

/** Default scvn state directory: ~/.scvn */
export function getScvnDir(override?: string): string {
  return override ?? path.join(homedir(), ".scvn");
}

/** Writable template-override directory: ~/.scvn/templates */
export function getTemplatesOverrideDir(scvnDirOverride?: string): string {
  return path.join(getScvnDir(scvnDirOverride), "templates");
}

/** Default config file path: ~/.scvn/config */
export function getConfigPath(override?: string): string {
  return override ?? path.join(getScvnDir(), "config");
}

/** Default history file path: ~/.scvn/history.jsonl */
export function getHistoryPath(override?: string): string {
  return override ?? path.join(getScvnDir(), "history.jsonl");
}

/** Previous scvn state directory: ~/.config/scvn (used for one-shot self-migration). */
export function getPreviousScvnDir(override?: string): string {
  return override ?? path.join(homedir(), ".config", "scvn");
}

/** Legacy sync-unity config path: ~/.config/sync-unity/config */
export function getLegacyConfigPath(override?: string): string {
  return override ?? path.join(homedir(), ".config", "sync-unity", "config");
}
