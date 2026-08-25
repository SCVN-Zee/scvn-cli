/**
 * util/file-compare.ts — Compare two files by content hash or existence.
 *
 * compareFiles(a, b) → { size, isNew, isUpToDate }
 *   - isNew: dst does not exist
 *   - isUpToDate: both exist and sha256 match
 *   - size: src file size in bytes (0 if src missing)
 *
 * Ported from sync-unity wholesale.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

export interface FileCompareResult {
  /** Byte size of src file */
  size: number;
  /** True when dst does not exist */
  isNew: boolean;
  /** True when both files exist and have identical content */
  isUpToDate: boolean;
}

/** sha256 of a file's bytes, or null when it cannot be read. */
export async function hashFile(filePath: string): Promise<string | null> {
  try {
    const data = await readFile(filePath);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

export async function compareFiles(
  src: string,
  dst: string
): Promise<FileCompareResult> {
  // Resolve src size
  let size = 0;
  try {
    const stats = await stat(src);
    size = stats.size;
  } catch {
    return { size: 0, isNew: false, isUpToDate: false };
  }

  // Check dst existence
  try {
    await stat(dst);
  } catch {
    return { size, isNew: true, isUpToDate: false };
  }

  // Both exist — compare by hash
  const [srcHash, dstHash] = await Promise.all([hashFile(src), hashFile(dst)]);
  const isUpToDate = srcHash !== null && dstHash !== null && srcHash === dstHash;

  return { size, isNew: false, isUpToDate };
}
