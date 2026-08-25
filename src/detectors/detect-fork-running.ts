/**
 * detectors/detect-fork-running.ts — Check whether Fork.app is currently running.
 *
 * Ported from fork-unity-setup/src/detectors/detect-fork-running.ts — no changes needed.
 */

import { execa } from "execa";

export async function detectForkRunning(): Promise<boolean> {
  try {
    const result = await execa("pgrep", ["-x", "Fork"], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
