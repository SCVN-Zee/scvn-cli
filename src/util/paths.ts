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
 * Resolve the nearest Unity `Assets` directory at or above `inputPath`.
 *
 * Walks the path segments leaf-first and returns the path truncated to and
 * including the last segment named "Assets" — the nearest Assets ancestor of a
 * folder browsed inside the Assets tree, or the folder itself when it already
 * IS Assets. Returns null when no segment is named "Assets". Pure: no I/O, so a
 * caller that also wants the "project root holds a child Assets" case checks the
 * filesystem itself.
 */
export function resolveAssetsDir(inputPath: string): string | null {
  const segments = inputPath.split("/");
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i] === "Assets") {
      return segments.slice(0, i + 1).join("/");
    }
  }
  return null;
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
