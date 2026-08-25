/**
 * config/save.ts — Atomically write ScvnConfig to ~/.scvn/config.
 *
 * Write strategy: temp file in same dir → fsync → rename.
 * This prevents partial writes surviving a crash (cross-device safe since
 * temp is in the same directory as target).
 *
 * Permissions: 0o600 (owner read/write only).
 * Format: shell-sourceable SCVN_KEY=value with header comment block.
 */

import { writeFile, mkdir, rename, open } from "node:fs/promises";
import { dirname } from "node:path";
import type { ScvnConfig } from "./types.js";
import { getConfigPath } from "./paths.js";

// ---------------------------------------------------------------------------
// Shell quoting (compatible with bash printf '%q')
// ---------------------------------------------------------------------------

/**
 * Quote a value for safe shell assignment.
 * Safe chars (alphanumeric, -, _, ., /, ~, :) emitted unquoted.
 * Empty string → '' (two single quotes) for bash source compatibility.
 * Others → single-quote wrapped with '\'' for embedded single quotes.
 */
export function quoteShell(value: string): string {
  if (value === "") return "''";
  if (/^[a-zA-Z0-9_./:~-]+$/.test(value)) return value;
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Config serialization
// ---------------------------------------------------------------------------

const HEADER = `\
# scvn config — edit via: scvn config
#
# SCVN_PROJECTS_ROOT    — Unity projects discovery root path`;

function serializeConfig(config: ScvnConfig): string {
  const lines: string[] = [HEADER, ""];

  if (config.projectsRoot !== undefined) {
    lines.push(`SCVN_PROJECTS_ROOT=${quoteShell(config.projectsRoot)}`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SaveConfigOptions {
  /** Override default config file path (for testing). */
  configPath?: string;
}

/**
 * Atomically write config to ~/.scvn/config (or override path).
 * Creates parent directory with 0o700 if absent.
 * Throws on I/O error — callers must handle.
 */
export async function saveConfig(
  config: ScvnConfig,
  opts: SaveConfigOptions = {}
): Promise<void> {
  const configPath = getConfigPath(opts.configPath);
  const directory = dirname(configPath);
  const tempPath = `${configPath}.tmp`;
  const content = serializeConfig(config);

  await mkdir(directory, { recursive: true, mode: 0o700 });

  // Write to temp file with restricted permissions
  await writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });

  // fsync to flush OS buffers before rename
  const fileHandle = await open(tempPath, "r");
  try {
    await fileHandle.sync();
  } finally {
    await fileHandle.close();
  }

  // Atomic rename — replaces target in one syscall
  await rename(tempPath, configPath);
}
