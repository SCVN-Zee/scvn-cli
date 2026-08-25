/**
 * util/real-path.ts — Resolve a path the way git reports it.
 *
 * `git rev-parse --show-toplevel` always prints a symlink-resolved path. A caller
 * path that still contains a symlink therefore cannot be compared against it:
 * on macOS `/tmp` and `/var` are symlinks to `/private/...`, so
 * `path.relative(gitRoot, projectDir)` between the two forms yields a garbage
 * `../../../..` traversal.
 *
 * That is not cosmetic. It silently produces exclude patterns that match nothing
 * (the vendored source shows up as thousands of untracked files) and a porcelain
 * pathspec that checks the wrong files (the gate passes without asserting
 * anything). Normalize at the boundary so everything downstream compares like
 * with like.
 */

import path from "node:path";
import { realpath } from "node:fs/promises";

/**
 * The symlink-resolved absolute form of `target`, matching what git prints.
 * A path that does not exist yet is returned resolved-but-not-realpath'd
 * (there is nothing to follow).
 */
export async function toRealPath(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}
