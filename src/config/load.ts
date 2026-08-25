/**
 * config/load.ts — Load ScvnConfig from file + environment variables.
 *
 * Precedence (highest wins):
 *   1. Current-run env:  SCVN_* vars
 *   2. Legacy-env fallback: SYNC_UNITY_* (only when SCVN equivalent absent)
 *   3. ~/.scvn/config file
 *
 * File format: shell-sourceable KEY=value pairs (same as sync-unity).
 * Comments (#), blank lines, and malformed lines are silently skipped.
 */

import { readFile } from "node:fs/promises";
import type { ScvnConfig } from "./types.js";
import { getConfigPath } from "./paths.js";

// ---------------------------------------------------------------------------
// Key mappings
// ---------------------------------------------------------------------------

/** Maps SCVN_* file/env keys → ScvnConfig field names */
const SCVN_KEY_MAP: Record<string, keyof ScvnConfig> = {
  SCVN_PROJECTS_ROOT:    "projectsRoot",
} as const;

/** Maps legacy SYNC_UNITY_* env keys → ScvnConfig field names */
const LEGACY_KEY_MAP: Record<string, keyof ScvnConfig> = {
  SYNC_UNITY_PROJECTS_ROOT:   "projectsRoot",
} as const;

// ---------------------------------------------------------------------------
// Parser helpers (ported from sync-unity/util/config.ts)
// ---------------------------------------------------------------------------

/**
 * Parse shell-sourceable KEY=value text into a plain record.
 * Rules:
 *   - Lines starting with # are comments (skip)
 *   - Blank / whitespace-only lines are skipped
 *   - Split on first = only — value may contain = characters
 *   - Key must match [A-Z_]+ (uppercase only, like bash env vars)
 */
export function parseConfigText(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex);
    if (!/^[A-Z_]+$/.test(key)) continue;
    const rawValue = trimmed.slice(equalsIndex + 1);
    result[key] = unquoteShell(rawValue);
  }
  return result;
}

/**
 * Unquote a value as bash would after reading a KEY=value assignment.
 * Handles single-quoted, $'...', double-quoted, and bare backslash-escaped values.
 */
function unquoteShell(value: string): string {
  // Single-quoted: 'value' — handle '\'' embedded escape
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/'\\''/g, "'");
  }
  // $'...' ANSI-C quoting (bash %q uses for control chars)
  if (value.startsWith("$'") && value.endsWith("'")) {
    return value.slice(2, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
  }
  // Double-quoted
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\\n/g, "")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  // Bare value: strip backslash escapes
  return value.replace(/\\(.)/g, "$1");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Override default config file path (for testing). */
  configPath?: string;
}

/**
 * Load ScvnConfig by merging file, legacy-env fallback, and current-env override.
 * Never throws — missing file or parse errors yield an empty/partial config.
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<ScvnConfig> {
  const configPath = getConfigPath(opts.configPath);
  const config: ScvnConfig = {};

  // Layer 1: file values
  let raw = "";
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    // File absent — start empty
  }

  const fileValues = parseConfigText(raw);
  for (const [key, field] of Object.entries(SCVN_KEY_MAP)) {
    const value = fileValues[key];
    if (value !== undefined && value !== "") {
      (config as Record<string, string>)[field] = value;
    }
  }

  // Layer 2: legacy-env fallback — only fills fields not yet set
  for (const [envKey, field] of Object.entries(LEGACY_KEY_MAP)) {
    if (config[field] !== undefined) continue; // already set from file
    const value = process.env[envKey];
    if (value) {
      // Deprecation notice — visible in stderr for tooling awareness
      process.stderr.write(
        `[scvn] deprecated: ${envKey} env var; rename to SCVN_${envKey.replace("SYNC_UNITY_", "")}\n`
      );
      (config as Record<string, string>)[field] = value;
    }
  }

  // Layer 3: current SCVN_* env always wins
  for (const [envKey, field] of Object.entries(SCVN_KEY_MAP)) {
    const value = process.env[envKey];
    if (value) {
      (config as Record<string, string>)[field] = value;
    }
  }

  return config;
}
