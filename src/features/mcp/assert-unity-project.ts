/**
 * features/mcp/assert-unity-project.ts — Prove a `--target` really is a Unity Assets dir.
 *
 * The interactive picker can only hand back a real project, but `--target` — which
 * is MANDATORY under `-y`, i.e. the scripted and artist paths — is whatever was
 * typed. Dropping one path segment (`.../Game` instead of `.../Game/Assets`) makes
 * `dirname(target)` the PROJECTS ROOT, and an install then vendors tens of
 * megabytes into `<projects-root>/Assets/UnityMCP`, outside any repo, and reports
 * success. Every downstream gate passes, because each is asking about a project
 * that isn't there.
 *
 * The bash original avoided this by locating the project itself
 * (`unity_project_of`: the dir owning `Packages/manifest.json`). scvn takes a path
 * instead, so it has to check the same thing.
 */

import path from "node:path";
import { access } from "node:fs/promises";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Throw unless `target` is a Unity project's `Assets` dir — i.e. it is named
 * `Assets` and its parent owns `Packages/manifest.json`.
 */
export async function assertUnityAssetsDir(target: string): Promise<void> {
  const projectDir = path.dirname(target);

  if (path.basename(target) !== "Assets") {
    throw new Error(
      `--target must be a Unity project's Assets dir, but got: ${target}\n` +
        `  did you mean ${path.join(target, "Assets")}?`,
    );
  }

  if (!(await exists(path.join(projectDir, "Packages", "manifest.json")))) {
    throw new Error(
      `${projectDir} is not a Unity project (no Packages/manifest.json)\n` +
        `  --target takes the project's Assets dir`,
    );
  }
}
