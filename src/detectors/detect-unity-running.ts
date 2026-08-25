/**
 * detectors/detect-unity-running.ts — Is the Unity Editor open on this project?
 *
 * Importing source while the editor is running races its asset importer, which
 * can leave the project with half-imported assets and regenerated .meta GUIDs.
 * The gate fails closed (install refuses unless --force).
 *
 * Both `-projectpath` and `-projectPath` are matched: Unity has shipped both
 * spellings, and a false negative here is the expensive direction.
 *
 * Mirrors detect-fork-running.ts (pgrep + execa reject:false).
 */

import { execa } from "execa";

/**
 * Escape a path for use inside an ERE. A project path holding `[`, `(`, `+`, or
 * `\` would otherwise be read as regex syntax: at best it matches the wrong
 * thing, at worst pgrep rejects the pattern, exits non-zero, and the gate reads
 * that as "Unity is not running" — precisely the false negative it exists to
 * prevent.
 */
function escapeEre(value: string): string {
  return value.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&");
}

/** True when a Unity process appears to have `projectDir` open. */
export async function detectUnityRunning(projectDir: string): Promise<boolean> {
  const pattern = escapeEre(projectDir);

  for (const flag of ["-projectpath", "-projectPath"]) {
    try {
      const result = await execa(
        "pgrep",
        ["-f", `Unity.*${flag}[= ]*${pattern}`],
        { reject: false },
      );
      if (result.exitCode === 0) return true;
    } catch {
      // pgrep missing (non-macOS/Linux) — cannot detect; treat as not running.
    }
  }
  return false;
}
