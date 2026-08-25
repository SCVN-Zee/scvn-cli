/**
 * config/migrate.ts — One-shot migration into ~/.scvn/.
 *
 * Sources (read-only, never deleted):
 *   0. ~/.config/scvn/{config,history.jsonl}
 *      — direct copy from previous scvn dir to new ~/.scvn dir
 *      — runs first so the rest of the migration treats it as a no-op
 *   1. ~/.config/sync-unity/config — maps SYNC_UNITY_* → SCVN_* keys
 *
 * Guard: skipped entirely if ~/.scvn/config already exists.
 * Best-effort: never throws; all errors logged to stderr.
 */

import { readFile, access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ScvnConfig } from "./types.js";
import {
  getConfigPath,
  getHistoryPath,
  getPreviousScvnDir,
  getLegacyConfigPath,
  getScvnDir,
} from "./paths.js";
import { parseConfigText } from "./load.js";
import { saveConfig } from "./save.js";

// ---------------------------------------------------------------------------
// Key mapping: old SYNC_UNITY_* → ScvnConfig fields
// ---------------------------------------------------------------------------

const LEGACY_FIELD_MAP: Record<string, keyof ScvnConfig> = {
  SYNC_UNITY_PROJECTS_ROOT:   "projectsRoot",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a single file iff source exists and destination does NOT.
 * Non-destructive: source is left in place. Logs to stderr.
 * Returns true if a copy happened.
 */
async function copyIfMissing(src: string, dst: string, label: string): Promise<boolean> {
  if (!(await fileExists(src))) return false;
  if (await fileExists(dst))    return false;
  try {
    await mkdir(path.dirname(dst), { recursive: true, mode: 0o700 });
    await copyFile(src, dst);
    process.stderr.write(`[scvn] migrate:   ${label}: ${src} → ${dst}\n`);
    return true;
  } catch (error) {
    process.stderr.write(`[scvn] migrate: could not copy ${src} → ${dst}: ${String(error)}\n`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MigrateOptions {
  /** Override scvn config path (for testing). */
  configPath?: string;
  /** Override scvn history path (for testing). */
  historyPath?: string;
  /** Override previous scvn dir ~/.config/scvn (for testing). */
  previousScvnDir?: string;
  /** Override legacy sync-unity config path (for testing). */
  legacyConfigPath?: string;
}

/**
 * Migrate legacy configs into ~/.scvn/config.
 * Idempotent: no-ops if scvn config already exists.
 * Best-effort: catches all errors and logs to stderr.
 */
export async function migrate(opts: MigrateOptions = {}): Promise<void> {
  const configPath              = getConfigPath(opts.configPath);
  const historyPath             = getHistoryPath(opts.historyPath);
  const previousScvnDir         = getPreviousScvnDir(opts.previousScvnDir);
  const legacyPath              = getLegacyConfigPath(opts.legacyConfigPath);

  try {
    // Guard: skip if scvn config already exists in new home.
    if (await fileExists(configPath)) {
      return;
    }

    // -------------------------------------------------------------------------
    // Step 0: Copy from previous scvn dir (~/.config/scvn) into ~/.scvn
    // -------------------------------------------------------------------------
    const copied: string[] = [];
    const previousConfigPath        = path.join(previousScvnDir, "config");
    const previousHistoryPath       = path.join(previousScvnDir, "history.jsonl");

    if (await copyIfMissing(previousConfigPath,  configPath,  "config"))        copied.push("config");
    if (await copyIfMissing(previousHistoryPath, historyPath, "history.jsonl")) copied.push("history.jsonl");

    if (copied.length > 0) {
      process.stderr.write(`[scvn] migrate: copied ${copied.length} file(s) from ${previousScvnDir} → ${getScvnDir()}\n`);
    }

    // If the config itself was copied, no further migration is needed —
    // the user already had a fully-formed scvn config.
    if (await fileExists(configPath)) {
      return;
    }

    // -------------------------------------------------------------------------
    // Step 1: Legacy sync-unity source
    // -------------------------------------------------------------------------
    const migrated: ScvnConfig = {};
    const migratedKeys: string[] = [];

    // Source 1: ~/.config/sync-unity/config
    if (await fileExists(legacyPath)) {
      let raw = "";
      try {
        raw = await readFile(legacyPath, "utf8");
      } catch (error) {
        process.stderr.write(`[scvn] migrate: could not read ${legacyPath}: ${String(error)}\n`);
      }

      const parsed = parseConfigText(raw);

      for (const [oldKey, field] of Object.entries(LEGACY_FIELD_MAP)) {
        const value = parsed[oldKey];
        if (value !== undefined && value !== "") {
          (migrated as Record<string, string>)[field] = value;
          migratedKeys.push(`${oldKey} → ${field}`);
        }
      }

      // Log any unrecognized keys so users are aware they were not migrated
      for (const key of Object.keys(parsed)) {
        if (!(key in LEGACY_FIELD_MAP)) {
          process.stderr.write(`[scvn] migrate: unrecognized key in old config (not migrated): ${key}\n`);
        }
      }
    }

    // Nothing to migrate — no sources found
    if (migratedKeys.length === 0) {
      return;
    }

    // Write new config
    await saveConfig(migrated, { configPath });

    process.stderr.write(`[scvn] migrate: created ${configPath}\n`);
    for (const entry of migratedKeys) {
      process.stderr.write(`[scvn] migrate:   ${entry}\n`);
    }
  } catch (error) {
    // Best-effort — never block startup
    process.stderr.write(`[scvn] migrate: unexpected error: ${String(error)}\n`);
  }
}
