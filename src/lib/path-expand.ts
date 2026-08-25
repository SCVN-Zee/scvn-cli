/**
 * lib/path-expand.ts — Expand leading ~ to the user's home directory.
 *
 * Ported from fork-unity-setup/src/lib/path-expand.ts — no changes needed.
 */

import { homedir } from "node:os";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return homedir() + path.slice(1);
  return path;
}

/** Inverse of expandHome — replaces a leading $HOME prefix with `~`. */
export function compactHome(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(home + "/")) return "~" + path.slice(home.length);
  return path;
}
