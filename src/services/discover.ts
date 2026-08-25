/**
 * services/discover.ts — Unity project discovery via fast-glob.
 *
 * Deep-scans up to 5 levels deep for `ProjectSettings/ProjectVersion.txt`
 * (the single project scanner — fork/export/import/setup all discover through
 * here), then enriches each match with the parsed Unity version, mtime, and
 * git repo info (root + branch), sorted newest-first.
 *
 * Label heuristic: prefers the `.git` parent folder name as `name`. Falls back
 * to path-based heuristic when no git repo is found.
 */

import fastGlob from "fast-glob";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { getRepoInfo } from "./git.js";

export interface Project {
  /** Absolute path to the Assets directory */
  path: string;
  /** Absolute path to the project root (parent of Assets / ProjectSettings) */
  projectRoot: string;
  /** Unity editor version from ProjectSettings/ProjectVersion.txt, or null when unparseable */
  projectVersion: string | null;
  /** Top-level project folder name (e.g. "luna_dino") */
  name: string;
  /** Unity scene/variant folder name (e.g. "luna_dino-playable-009") */
  scene: string;
  /** Current git branch of the repo containing Assets, or null */
  branch: string | null;
  /** mtime in milliseconds (from fs.stat) */
  mtimeMs: number;
}

const LEGACY_LAYOUT = /^(.+?)\/unity_project\/([^/]+)\/Assets$/;

/**
 * Derive `(name, scene)` for a project.
 *
 * Priority:
 * 1. If a git repo root is detected, use its folder basename as `name`
 *    and the path from repo to projectRoot as `scene` (basename if same dir).
 * 2. Else legacy `<name>/unity_project/<scene>/Assets` regex.
 * 3. Else fall back to `(firstSegment, basename(projectRoot))`.
 */
function deriveLabel(
  relAssets: string,
  projectRoot: string,
  repoRoot: string | null,
): { name: string; scene: string } {
  if (repoRoot) {
    const name = path.basename(repoRoot);
    const rel = path.relative(repoRoot, projectRoot);
    const stripped = rel.replace(/^unity_project\/?/, "");
    const scene = stripped === "" ? path.basename(projectRoot) : stripped;
    return { name, scene };
  }
  const match = LEGACY_LAYOUT.exec(relAssets);
  if (match) {
    const prefix = match[1] ?? "";
    const scene = match[2] ?? "";
    const name = prefix.split("/")[0] ?? "";
    return { name, scene };
  }
  const name = relAssets.split("/")[0] ?? "";
  const scene = path.basename(projectRoot);
  return { name, scene };
}

/**
 * Discover all Unity project Assets directories under `root`.
 * Returns projects sorted by mtime descending (most recently touched first).
 */
export async function discoverUnityProjects(root: string): Promise<Project[]> {
  const normalizedRoot = root.replace(/\/+$/, "");
  // deep counts traversed directory levels; ProjectVersion.txt sits at
  // `<projectRoot>/ProjectSettings/`, so a project-root depth of 5 needs
  // deep: 7 (5 path segments + ProjectSettings + the file itself).
  const matches = await fastGlob("**/ProjectSettings/ProjectVersion.txt", {
    cwd: normalizedRoot,
    deep: 7,
    ignore: ["**/Library/**", "**/node_modules/**", "**/.git/**", "**/Temp/**"],
    followSymbolicLinks: false,
    suppressErrors: true,
    absolute: true,
    onlyFiles: true,
  });

  const settled = await Promise.all(
    matches.map(async (file): Promise<Project | null> => {
      const projectRoot = path.dirname(path.dirname(file));
      const assetsPath = path.join(projectRoot, "Assets");
      try {
        const assetsStat = await stat(assetsPath);
        if (!assetsStat.isDirectory()) return null;

        // Parse the Unity editor version from the matched ProjectVersion.txt
        let projectVersion: string | null = null;
        try {
          const content = await readFile(file, "utf8");
          projectVersion = /m_EditorVersion:\s*(\S+)/.exec(content)?.[1] ?? null;
        } catch {
          // unreadable ProjectVersion.txt — version unknown
        }

        const repoInfo = await Promise.race([
          getRepoInfo(assetsPath).catch(() => ({ root: null, branch: null })),
          new Promise<{ root: null; branch: null }>((resolve) =>
            setTimeout(() => resolve({ root: null, branch: null }), 500),
          ),
        ]);

        const relAssets = path.relative(normalizedRoot, assetsPath);
        const { name, scene } = deriveLabel(relAssets, projectRoot, repoInfo.root);

        return {
          path: assetsPath,
          projectRoot,
          projectVersion,
          name,
          scene,
          branch: repoInfo.branch,
          mtimeMs: assetsStat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
  );

  return settled
    .filter((project): project is Project => project !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
}
