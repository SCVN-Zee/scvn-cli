/**
 * detectors/detect-beyond-compare.ts — Check whether Beyond Compare is installed.
 *
 * Ported from fork-unity-setup/src/detectors/detect-beyond-compare.ts.
 * Import path updated to scvn lib/fork-paths.
 */

import fs from "fs/promises";
import { BEYOND_COMPARE_PATH } from "../lib/fork-paths.js";

export interface BeyondCompareResult {
  found: boolean;
  path: string | null;
}

export async function detectBeyondCompare(
  probePath: string = BEYOND_COMPARE_PATH,
): Promise<BeyondCompareResult> {
  try {
    await fs.access(probePath, fs.constants.X_OK);
    return { found: true, path: probePath };
  } catch {
    return { found: false, path: null };
  }
}
