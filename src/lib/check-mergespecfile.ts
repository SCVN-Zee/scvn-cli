/**
 * lib/check-mergespecfile.ts — Verify that mergespecfile.txt contains a BC fallback line.
 *
 * Ported from fork-unity-setup/src/lib/check-mergespecfile.ts — no changes needed.
 */

import fs from "fs/promises";

export interface MergespecCheck {
  ok: boolean;
  path: string;
  reason?: string;
}

const BC_MARKER = "Beyond Compare.app/Contents/MacOS/bcomp";

export async function checkMergespecfile(
  mergeSpecPath: string,
): Promise<MergespecCheck> {
  try {
    const content = await fs.readFile(mergeSpecPath, "utf8");
    if (content.includes(BC_MARKER)) {
      return { ok: true, path: mergeSpecPath };
    }
    return {
      ok: false,
      path: mergeSpecPath,
      reason: "Beyond Compare fallback line not found in mergespecfile.txt",
    };
  } catch (err) {
    return {
      ok: false,
      path: mergeSpecPath,
      reason: `cannot read mergespecfile.txt: ${(err as Error).message}`,
    };
  }
}
