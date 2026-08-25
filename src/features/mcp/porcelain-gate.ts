/**
 * features/mcp/porcelain-gate.ts — Assert the UPM machinery files are clean to git.
 *
 * Vendoring as Assets/ source means UPM is never involved, so these three files
 * stay byte-equal to HEAD BY CONSTRUCTION:
 *
 *   Packages/manifest.json
 *   Packages/packages-lock.json
 *   ProjectSettings/PackageManagerSettings.asset
 *
 * If they are dirty after an install, something else moved them — and that is
 * worth stopping for, because it is the difference between "nothing to commit"
 * and quietly committing a UPM dependency on a package that no longer exists.
 *
 * READ-ONLY. It never stages, never commits, never checks out. Its pathspec is
 * scoped to exactly those three files, so unrelated local edits are none of its
 * business.
 *
 * Ports `porcelain_gate` (unity-mcp-localize.sh:608).
 */

import path from "node:path";
import { execa } from "execa";
import { MACHINERY_FILES } from "./mcp-constants.js";

/** Paths relative to the repo root — a project may be nested inside it. */
function machineryPathspec(repoRoot: string, unityProjectDir: string): string[] {
  const rel = path.relative(repoRoot, unityProjectDir);
  return MACHINERY_FILES.map((file) => (rel ? path.join(rel, file) : file));
}

/**
 * Throw when any machinery file has uncommitted changes.
 *
 * A git FAILURE is also a failure. Swallowing it would turn the one gate that
 * proves the headline invariant — "after an install there is nothing to commit"
 * — into a no-op that always passes, which is exactly what it must never be. The
 * caller only invokes this inside a repo, so there is no benign error to absorb.
 */
export async function porcelainGate(
  repoRoot: string,
  unityProjectDir: string,
): Promise<void> {
  let dirty: string;
  try {
    const { stdout } = await execa(
      "git",
      ["-C", repoRoot, "status", "--porcelain", "--", ...machineryPathspec(repoRoot, unityProjectDir)],
      { stdio: "pipe" },
    );
    dirty = stdout.trim();
  } catch (err: unknown) {
    throw new Error(
      `porcelain gate could not run: ${err instanceof Error ? err.message : String(err)}\n` +
        `  (could not verify the package-machinery files are clean — refusing to claim they are)`,
    );
  }

  if (dirty) {
    throw new Error(
      `porcelain gate FAILED — package-machinery files are dirty:\n${dirty}\n` +
        `  (these must stay byte-equal to HEAD; investigate before committing)`,
    );
  }
}
