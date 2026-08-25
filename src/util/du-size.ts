/**
 * util/du-size.ts — Node-native disk usage helpers (no shell out).
 *
 * duSize(dirPath)     → total byte count via recursive fs walk
 * formatBytes(bytes)  → re-exported from util/format-bytes.ts
 *
 * Ported from sync-unity. formatBytes delegates to the shared format-bytes.ts
 * already present in phase 2 rather than duplicating the implementation.
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// Re-export from shared util so callers can import from a single place
export { formatBytes } from "./format-bytes.js";

/** Recursively sum file sizes under dirPath. Returns 0 if path missing. */
export async function duSize(dirPath: string): Promise<number> {
  try {
    return await sumBytes(dirPath);
  } catch {
    return 0;
  }
}

async function sumBytes(targetPath: string): Promise<number> {
  const info = await stat(targetPath);
  if (info.isDirectory()) {
    const entries = await readdir(targetPath);
    const sizes = await Promise.all(
      entries.map((entry) => sumBytes(path.join(targetPath, entry)))
    );
    return sizes.reduce((accumulator, size) => accumulator + size, 0);
  }
  return info.size;
}
