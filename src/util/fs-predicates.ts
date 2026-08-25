/**
 * util/fs-predicates.ts — Filesystem existence/type predicates.
 *
 * exists(path)  → true if path exists (any type)
 * isDir(path)   → true if path exists and is a directory
 * isFile(path)  → true if path exists and is a regular file
 *
 * All functions return false on any error rather than throwing.
 * Ported from sync-unity wholesale.
 */

import { stat } from "node:fs/promises";

/** Return true if `path` exists (any type: file, dir, symlink, etc.) */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Return true if `path` exists and is a directory. */
export async function isDir(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/** Return true if `path` exists and is a regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}
