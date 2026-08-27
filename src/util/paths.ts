/**
 * util/paths.ts — Pure path helpers (no I/O, no external deps).
 *
 * shortenPath  — strips projectsRoot prefix or replaces HOME with ~
 * guardDistinct — throws if two resolved paths are identical
 *
 * Ported from sync-unity. expandHome lives in lib/path-expand.ts and is
 * re-exported here for callers that already use util/paths.js as a single import surface.
 */

import { homedir } from "node:os";
import { resolve } from "node:path";

export { expandHome } from "../lib/path-expand.js";

/**
 * Shorten an absolute path for display purposes only.
 * Never feed the result back into a command.
 *
 * Priority:
 *   1) Strip projectsRoot prefix → project-relative path
 *   2) Replace HOME prefix with ~/
 *   3) Return as-is
 */
export function shortenPath(path: string, projectsRoot?: string): string {
  const root = projectsRoot ?? process.env["SCVN_PROJECTS_ROOT"] ?? process.env["SYNC_UNITY_PROJECTS_ROOT"];
  if (root && path.startsWith(root + "/")) {
    return path.slice(root.length + 1);
  }
  const home = homedir();
  if (home && path.startsWith(home + "/")) {
    return "~/" + path.slice(home.length + 1);
  }
  return path;
}

/**
 * Derive a display name for a project from its Assets-dir path:
 * "/projects/luna/Assets" → "luna". Falls back to the last segment.
 */
export function deriveProjectName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[segments.length - 1] === "Assets") {
    return segments[segments.length - 2] ?? projectPath;
  }
  return segments[segments.length - 1] ?? projectPath;
}

/**
 * Throw an Error if pathA and pathB resolve to the same real path.
 * Uses path.resolve (sync, no fs).
 */
export function guardDistinct(pathA: string, pathB: string): void {
  const resolvedA = resolve(pathA);
  const resolvedB = resolve(pathB);
  if (resolvedA === resolvedB) {
    throw new Error(`Source and target are the same path: ${resolvedA}`);
  }
}
