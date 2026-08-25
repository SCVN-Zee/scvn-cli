/**
 * lib/verify-fork-prefs.ts — Read and parse Fork's defaults plist for idempotency checks.
 *
 * Ported from fork-unity-setup/src/lib/verify-fork-prefs.ts — import path adjusted only.
 */

import { execa } from "execa";
import { FORK_BUNDLE_ID } from "./fork-paths.js";

export type ForkPrefRecord = Record<string, string>;

export function parseDefaultsReadDict(stdout: string): ForkPrefRecord | null {
  // Format emitted by `defaults read <bundle> <key>` for a dict:
  // {
  //     ApplicationPath = "/Applications/Beyond Compare.app/Contents/MacOS/bcomp";
  //     Arguments = "$LOCAL $REMOTE";
  //     Type = BeyondCompare;
  // }
  if (!stdout.trim().startsWith("{")) return null;
  const result: ForkPrefRecord = {};
  const re = /"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) {
    const key = m[1] ?? "";
    const raw = m[2] !== undefined ? m[2] : m[3] ?? "";
    result[key] = raw.replace(/\\"/g, '"');
  }
  return result;
}

export async function readForkPref(
  key: string,
): Promise<ForkPrefRecord | null> {
  try {
    const result = await execa("defaults", ["read", FORK_BUNDLE_ID, key], {
      reject: false,
    });
    if (result.exitCode !== 0) return null;
    return parseDefaultsReadDict(result.stdout);
  } catch {
    return null;
  }
}
