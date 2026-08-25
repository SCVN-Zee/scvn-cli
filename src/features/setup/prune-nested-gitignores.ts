/**
 * features/setup/prune-nested-gitignores.ts — Delete every NESTED `.gitignore`
 * in the repo containing `target`, keeping only the repo-root one.
 *
 * Enumeration is git-native (services/git.listNestedGitignores), so submodule /
 * embedded-repo contents and git-ignored dirs are skipped automatically. Removal
 * is a uniform `fs.rm`: a tracked deletion surfaces as an unstaged change in
 * `git status` for the user to commit. Silent in the common case (no confirm).
 *
 * Ancestor guard — the prune scope is the WHOLE enclosing git repo. When that
 * repo sits ABOVE the target Unity project (project nested in a larger / mono /
 * accidental `$HOME` repo), the blast radius exceeds "this project", so:
 *   - under autoYes (-y) → refuse (skipped); never silently delete a wide scope
 *   - interactively      → require confirmWideScope() before deleting
 * When the repo root IS the project root (each Unity project is its own repo),
 * prune runs silently as before.
 *
 * Pre-flight:
 *   - not a git repo → skipped (the root template still installs to the Unity
 *     project root upstream via setupTemplate).
 *
 * opts.dryRun           — report would-remove, write nothing (never prompts)
 * opts.autoYes          — refuse the wide-scope (nested) case instead of prompting
 * opts.confirmWideScope — confirm gate reached only in the nested-repo case
 * opts.reporter         — status/log output seam
 */

import path from "node:path";
import { rm, realpath } from "node:fs/promises";
import { getRepoRoot, listNestedGitignores } from "../../services/git.js";
import type { SyncReporter } from "../transfer/reporter.js";

/** Details handed to the wide-scope confirm gate (nested-repo case). */
export interface WideScopePrune {
  repoRoot:    string;
  projectRoot: string;
  count:       number;
}

export interface PruneNestedGitignoresOpts {
  dryRun?:           boolean;
  autoYes?:          boolean;
  reporter?:         Pick<SyncReporter, "onStatus" | "onLog">;
  /** Confirm gate reached only when the repo root is ABOVE the target project. */
  confirmWideScope?: (info: WideScopePrune) => Promise<boolean>;
}

/** realpath that falls back to a plain resolve for paths that do not exist. */
async function realpathSafe(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch {
    return path.resolve(p);
  }
}

export async function pruneNestedGitignores(
  target: string,
  opts: PruneNestedGitignoresOpts = {},
): Promise<void> {
  const dryRun   = opts.dryRun  ?? false;
  const autoYes  = opts.autoYes ?? false;
  const reporter = opts.reporter;

  const repo = await getRepoRoot(target);
  if (!repo) {
    reporter?.onStatus({ status: "skipped", detail: "no git repo — prune skipped" });
    return;
  }

  const nested = await listNestedGitignores(repo);
  if (nested.length === 0) {
    reporter?.onStatus({ status: "done", detail: "no nested .gitignore" });
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
    for (const rel of nested) {
      reporter?.onLog({ ts: Date.now(), level: "info", message: `would remove ${rel}` });
    }
    const scopeNote = wideScope ? ` across ${repo} (above project ${projectRoot})` : "";
    reporter?.onStatus({
      status: "done",
      detail: `[dry-run] ${nested.length} nested would be removed${scopeNote}`,
    });
    return;
  }

  // Wide-scope (nested-repo) case needs an explicit go-ahead; -y refuses outright.
  if (wideScope) {
    if (autoYes) {
      reporter?.onStatus({
        status: "skipped",
        detail: `repo root ${repo} is above the project — prune skipped under -y (run interactively to confirm)`,
      });
      return;
    }
    const approved = opts.confirmWideScope
      ? await opts.confirmWideScope({ repoRoot: repo, projectRoot, count: nested.length })
      : false; // no confirm seam → refuse rather than silently prune a wide scope
    if (!approved) {
      reporter?.onStatus({ status: "skipped", detail: "wide-scope prune declined" });
      return;
    }
  }

  // Delete each nested file independently so one failure does not abort the rest
  // (parity with setupTemplate's failure reporting).
  let removed = 0;
  const failures: string[] = [];
  for (const rel of nested) {
    try {
      await rm(path.join(repo, rel), { force: true });
      removed++;
      reporter?.onLog({ ts: Date.now(), level: "info", message: `removed ${rel}` });
    } catch (err: unknown) {
      failures.push(rel);
      const message = err instanceof Error ? err.message : String(err);
      reporter?.onLog({ ts: Date.now(), level: "warn", message: `failed to remove ${rel}: ${message}` });
    }
  }

  if (failures.length > 0) {
    reporter?.onStatus({ status: "failed", error: `${removed} removed, ${failures.length} failed` });
  } else {
    reporter?.onStatus({ status: "done", detail: `${removed} nested removed` });
  }
}
