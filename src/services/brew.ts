/**
 * services/brew.ts — Homebrew CLI wrappers.
 *
 * Ported from sync-unity/src/services/brew.ts with import paths adjusted for scvn.
 */

import { execa } from "execa";

/**
 * Check whether a CLI tool is available in PATH.
 * Uses `which` (POSIX) rather than `command -v` since execa doesn't run shell builtins.
 */
export async function isInstalled(packageName: string): Promise<boolean> {
  try {
    await execa("which", [packageName], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a Homebrew package.
 * Inherits stdio so brew progress is visible to the user.
 * Throws if brew exits non-zero.
 */
export async function install(packageName: string): Promise<void> {
  await execa("brew", ["install", packageName], { stdio: "inherit" });
}
