/**
 * services/git.ts — Thin execa wrappers around git CLI.
 *
 * Ported from sync-unity/src/services/git.ts with import paths adjusted for scvn.
 * All functions use array args (no shell interpolation).
 */

import { execa } from "execa";
import path from "node:path";
import { commandExists } from "../util/command-exists.js";

// ---------------------------------------------------------------------------
// Repo info
// ---------------------------------------------------------------------------

/** Return the absolute path of the git repo root containing `cwd`, or null. */
export async function getRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd, stdio: "pipe" }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Return the current branch name for the repo at `cwd`, or null. */
export async function getCurrentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, stdio: "pipe" }
    );
    const branch = stdout.trim();
    return branch === "HEAD" ? null : branch || null;
  } catch {
    return null;
  }
}

/**
 * Single-call combo: returns repo top-level path AND current branch.
 * Saves one git subprocess vs. calling `getRepoRoot` + `getCurrentBranch`.
 */
export async function getRepoInfo(
  cwd: string
): Promise<{ root: string | null; branch: string | null }> {
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      { cwd, stdio: "pipe" }
    );
    const lines = stdout.split("\n").map((line) => line.trim());
    const root = lines[0] || null;
    const branchRef = lines[1] ?? "";
    const branch = branchRef === "HEAD" ? null : (branchRef || null);
    return { root, branch };
  } catch {
    return { root: null, branch: null };
  }
}

/**
 * Absolute path of the `info/exclude` that governs the repo containing `cwd`,
 * or null when `cwd` is not in a repo.
 *
 * Asks git rather than joining `<toplevel>/.git/info/exclude`: in a submodule
 * `.git` is a FILE pointing at `<super>/.git/modules/<name>`, and in a linked
 * worktree the exclude lives in the common dir. Both would be mis-targeted by a
 * naive join. `--git-path` yields a cwd-relative path for the simple case, so
 * resolve it against the directory we asked from.
 */
export async function getGitInfoExcludePath(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["rev-parse", "--git-path", "info/exclude"],
      { cwd, stdio: "pipe" }
    );
    const gitPath = stdout.trim();
    return gitPath ? path.resolve(cwd, gitPath) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local git config (per-repo, not committed)
// ---------------------------------------------------------------------------

/** Read a local git config key. Returns null if not set. */
export async function getLocalConfig(
  repo: string,
  key: string
): Promise<string | null> {
  try {
    const { stdout } = await execa(
      "git",
      ["-C", repo, "config", "--local", key],
      { stdio: "pipe" }
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Set a local git config key (writes to .git/config, never committed). */
export async function setLocalConfig(
  repo: string,
  key: string,
  value: string
): Promise<void> {
  await execa(
    "git",
    ["-C", repo, "config", key, value],
    { stdio: "pipe" }
  );
}

/**
 * Unset a local git config key.
 * Silently ignores "key not found" errors (exit code 5 from git).
 */
export async function unsetLocalConfig(
  repo: string,
  key: string
): Promise<void> {
  try {
    await execa(
      "git",
      ["-C", repo, "config", "--unset", key],
      { stdio: "pipe" }
    );
  } catch {
    // exit 5 = key not found; treat as success
  }
}

// ---------------------------------------------------------------------------
// Submodule enumeration
// ---------------------------------------------------------------------------

/** A submodule as declared in .gitmodules: its config NAME and working-tree PATH. */
export interface SubmoduleEntry {
  /** `[submodule "<name>"]` section key — git resolves `submodule.<name>.*` by this. */
  name: string;
  /** Working-tree path (the `path =` value). Equals `name` unless added with `--name`. */
  path: string;
}

/**
 * List all submodules defined in .gitmodules (tracked) as {name, path} pairs.
 *
 * Git resolves per-submodule config (e.g. `submodule.<name>.ignore`) by the
 * section NAME, not the path. The two are equal for submodules added without
 * `--name`, but callers that WRITE submodule config must key on `name`.
 */
export async function listSubmodules(repo: string): Promise<SubmoduleEntry[]> {
  const gitmodules = `${repo}/.gitmodules`;
  try {
    const { stdout } = await execa(
      "git",
      [
        "-C", repo,
        "config", "-f", gitmodules,
        "--get-regexp", "^submodule\\..*\\.path$",
      ],
      { stdio: "pipe" }
    );
    return stdout
      .split("\n")
      .map((line) => {
        // Each line: "submodule.<name>.path <path>" — name may contain dots/slashes,
        // so anchor on the trailing ".path" + whitespace before the value.
        const match = line.match(/^submodule\.(.+)\.path\s+(.+)$/);
        return match ? { name: match[1]!, path: match[2]! } : null;
      })
      .filter((entry): entry is SubmoduleEntry => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Read the `ignore` value declared in `.gitmodules` for every submodule that
 * sets one, as a `name -> value` map (`dirty` | `all` | `untracked` | `none`).
 *
 * This is the tracked, committed default git falls back to when local
 * `.git/config` has no `submodule.<name>.ignore` override. Keyed on the
 * section NAME, matching how git resolves the runtime value. Submodules with
 * no `ignore =` line are absent from the map.
 */
export async function listSubmoduleGitmodulesIgnore(
  repo: string,
): Promise<Record<string, string>> {
  const gitmodules = `${repo}/.gitmodules`;
  try {
    const { stdout } = await execa(
      "git",
      [
        "-C", repo,
        "config", "-f", gitmodules,
        "--get-regexp", "^submodule\\..*\\.ignore$",
      ],
      { stdio: "pipe" }
    );
    const map: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      // Each line: "submodule.<name>.ignore <value>" — anchor on the trailing
      // ".ignore" + whitespace so a dotted/slashed name is captured whole.
      const match = line.match(/^submodule\.(.+)\.ignore\s+(.+)$/);
      if (match) map[match[1]!] = match[2]!.trim();
    }
    return map;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Nested .gitignore enumeration
// ---------------------------------------------------------------------------

/**
 * List every NESTED `.gitignore` in the repo at `repoRoot`, excluding the
 * repo-root `.gitignore` itself. Returns repo-root-relative POSIX paths.
 *
 * Enumerates tracked ∪ untracked-but-not-ignored files in a single
 * `git ls-files` call:
 *   --cached            → tracked files
 *   --others            → untracked files
 *   --exclude-standard  → honor .gitignore/exclude, so files under ignored dirs
 *                         (Library/, Temp/, node_modules/, …) are NOT listed
 *
 * Submodule / embedded-repo contents are never listed — the superproject's
 * ls-files treats a nested repo as a single gitlink and does not descend into
 * it. The `*.gitignore` pathspec narrows git's output; the basename guard then
 * drops same-suffix files (e.g. `keep.gitignore`) so only files literally named
 * `.gitignore` survive. Returns `[]` on any git failure (not a repo, etc.).
 */
export async function listNestedGitignores(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      [
        "-C", repoRoot,
        "ls-files", "-z",
        "--cached", "--others", "--exclude-standard",
        "--", "*.gitignore",
      ],
      { stdio: "pipe" }
    );

    const nested = new Set<string>();
    for (const rel of stdout.split("\0")) {
      if (!rel) continue;                              // drop empties (incl. trailing NUL)
      if (rel === ".gitignore") continue;              // keep the repo-root file
      if (path.basename(rel) !== ".gitignore") continue; // only literal `.gitignore`
      nested.add(rel);
    }
    return [...nested];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tracked-but-now-ignored files (ignore-time untrack)
// ---------------------------------------------------------------------------

/**
 * List files that are tracked in the index but now match the repo's ignore
 * rules — the set that `scvn git --ignore` should untrack. Uses
 * `git ls-files -z -i -c --exclude-standard` (the `-i` flag requires `-c`/`-o`
 * plus `--exclude-standard`; `-c` restricts to tracked/cached files). Paths are
 * repo-root-relative POSIX. NUL-delimited so filenames with spaces/newlines are
 * safe. Returns `[]` on any git failure (not a repo, etc.).
 */
export async function listTrackedIgnoredFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execa(
      "git",
      ["-C", repoRoot, "ls-files", "-z", "-i", "-c", "--exclude-standard"],
      { stdio: "pipe" }
    );
    return stdout.split("\0").filter((rel) => rel !== "");
  } catch {
    return [];
  }
}

/**
 * Remove `files` (repo-root-relative) from the git index only — the worktree
 * copies are kept (no `-f`/`-r`). The NUL-joined list is fed on stdin via
 * `--pathspec-from-file=- --pathspec-file-nul`, so paths with spaces/unicode are
 * handled exactly. Each entry is prefixed with the `:(literal)` pathspec magic so
 * a filename containing glob metacharacters (`*`, `[`, `]`, a leading `:`) is
 * matched verbatim, never interpreted as a pattern. No-op on an empty list.
 */
export async function gitRmCached(repoRoot: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const pathspecs = files.map((f) => `:(literal)${f}`);
  await execa(
    "git",
    [
      "-C", repoRoot,
      "rm", "--cached", "--quiet",
      "--pathspec-from-file=-", "--pathspec-file-nul",
    ],
    { input: pathspecs.join("\0"), stdio: "pipe" }
  );
}

// ---------------------------------------------------------------------------
// Git LFS
// ---------------------------------------------------------------------------

/** True when the `git-lfs` binary resolves in PATH (the `git lfs` subcommand). */
export async function detectGitLfs(): Promise<boolean> {
  return commandExists("git-lfs");
}

/**
 * Run `git lfs install --local` in `repo` — installs the LFS clean/smudge
 * filters into the repo's own `.git/config` only (never the global config).
 * Requires the git-lfs binary; guard with detectGitLfs() first.
 */
export async function gitLfsInstallLocal(repo: string): Promise<void> {
  await execa(
    "git",
    ["-C", repo, "lfs", "install", "--local"],
    { stdio: "pipe" }
  );
}
