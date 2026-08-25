/**
 * features/setup/untrack-ignored-files.ts — After `.gitignore` is applied,
 * remove from the git index any files that are already tracked but now match
 * the ignore rules. The worktree copies stay on disk; the removals surface as
 * staged deletions in `git status` for the user to commit.
 *
 * Enumeration is git-native (services/git.listTrackedIgnoredFiles), so it
 * reflects the freshly written `.gitignore`. Removal is a single index-only
 * `git rm --cached` (services/git.gitRmCached) — never touches the worktree.
 *
 * Ancestor guard — the untrack scope is the WHOLE enclosing git repo (that is
 * what governs the index). When that repo sits ABOVE the target Unity project
 * (project nested in a larger / mono / accidental `$HOME` repo), the blast
 * radius exceeds "this project", so — identical policy to pruneNestedGitignores:
 *   - under autoYes (-y) → refuse (skipped); never silently untrack a wide scope
 *   - interactively      → require confirmWideScope() before untracking
 * When the repo root IS the project root (each Unity project is its own repo),
 * untrack runs silently as before.
 *
 * Pre-flight:
 *   - not a git repo → skipped (never a failure; parity with prune / gitexclude).
 *
 * opts.dryRun           — report would-untrack, write nothing (never prompts)
 * opts.autoYes          — refuse the wide-scope (nested) case instead of prompting
 * opts.confirmWideScope — confirm gate reached only in the nested-repo case
 * opts.reporter         — status/log output seam
 */

import path from "node:path";
import { realpath } from "node:fs/promises";
import { getRepoRoot, listTrackedIgnoredFiles, gitRmCached } from "../../services/git.js";
import type { SyncReporter } from "../transfer/reporter.js";

/** Details handed to the wide-scope confirm gate (nested-repo case). */
export interface WideScopeUntrack {
  repoRoot:    string;
  projectRoot: string;
  count:       number;
}

export interface UntrackIgnoredFilesOpts {
  dryRun?:           boolean;
  autoYes?:          boolean;
  reporter?:         Pick<SyncReporter, "onStatus" | "onLog">;
  /** Confirm gate reached only when the repo root is ABOVE the target project. */
  confirmWideScope?: (info: WideScopeUntrack) => Promise<boolean>;
}

/** realpath that falls back to a plain resolve for paths that do not exist. */
async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

export async function untrackIgnoredFiles(
  target: string,
  opts: UntrackIgnoredFilesOpts = {},
): Promise<void> {
  const dryRun   = opts.dryRun  ?? false;
  const autoYes  = opts.autoYes ?? false;
  const reporter = opts.reporter;

  const repo = await getRepoRoot(target);
  if (!repo) {
    reporter?.onStatus({ status: "skipped", detail: "no git repo — untrack skipped" });
    return;
  }

  const files = await listTrackedIgnoredFiles(repo);
  if (files.length === 0) {
    reporter?.onStatus({ status: "done", detail: "nothing to untrack" });
    return;
  }

  // Ancestor guard: is the enclosing repo ABOVE the target Unity project?
  // Compare real paths so symlinked project/temp dirs don't false-positive.
  const [repoReal, projectRoot] = await Promise.all([
    realpathSafe(repo),
    realpathSafe(path.dirname(target)),
  ]);
  const wideScope = repoReal !== projectRoot;

  // Dry-run previews only; it never prompts. Flag the wide scope in the report.
  if (dryRun) {
    for (const rel of files) {
      reporter?.onLog({ ts: Date.now(), level: "info", message: `would untrack ${rel}` });
    }
    const scopeNote = wideScope ? ` across ${repo} (above project ${projectRoot})` : "";
    reporter?.onStatus({
      status: "done",
      detail: `[dry-run] would untrack ${files.length} file(s)${scopeNote}`,
    });
    return;
  }

  // Wide-scope (nested-repo) case needs an explicit go-ahead; -y refuses outright.
  if (wideScope) {
    if (autoYes) {
      reporter?.onStatus({
        status: "skipped",
        detail: `repo root ${repo} is above the project — untrack skipped under -y (run interactively to confirm)`,
      });
      return;
    }
    const approved = opts.confirmWideScope
      ? await opts.confirmWideScope({ repoRoot: repo, projectRoot, count: files.length })
      : false; // no confirm seam → refuse rather than silently untrack a wide scope
    if (!approved) {
      reporter?.onStatus({ status: "skipped", detail: "wide-scope untrack declined" });
      return;
    }
  }

  await gitRmCached(repo, files);
  for (const rel of files) {
    reporter?.onLog({ ts: Date.now(), level: "info", message: `untracked ${rel}` });
  }
  reporter?.onStatus({
    status: "done",
    detail: `untracked ${files.length} file(s) — commit the deletions`,
  });
}
