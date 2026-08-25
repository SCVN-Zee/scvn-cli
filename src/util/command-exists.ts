/**
 * util/command-exists.ts — Check if a CLI binary is available in PATH.
 *
 * commandExists(bin) → boolean
 * Ported from sync-unity wholesale.
 */

import { execa } from "execa";

/**
 * Returns true if `bin` resolves to an executable in PATH.
 * Equivalent to `command -v bin` or `which bin` in bash.
 */
export async function commandExists(bin: string): Promise<boolean> {
  try {
    await execa("which", [bin], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
