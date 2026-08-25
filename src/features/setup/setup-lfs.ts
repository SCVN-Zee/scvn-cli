/**
 * features/setup/setup-lfs.ts — Set up Git LFS for a Unity project.
 *
 * Non-destructive: `git lfs install --local` (per-repo filters only) + refresh
 * the LFS track block in the repo-root `.gitattributes`. Coexists with a fork
 * smart-merge block (distinct marker pair) via writeLfsAttributes.
 *
 * Reporter status contract (consumed by the step-runner):
 *   - no git repo         → "skipped" (parity with gitexclude), not a failure
 *   - git-lfs binary gone → THROWS ("brew install git-lfs") → step "failed", exit 1
 *   - dryRun              → "done" with a "would …" detail, no writes
 *   - applied             → "done"
 */

import path from "node:path";
import {
  getRepoRoot,
  detectGitLfs,
  gitLfsInstallLocal,
} from "../../services/git.js";
import { writeLfsAttributes } from "../../writers/write-lfs-attributes.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface SetupLfsOpts {
  dryRun?:  boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

export async function setupLfs(
  target: string,
  opts: SetupLfsOpts = {},
): Promise<void> {
  const dryRun   = opts.dryRun ?? false;
  const reporter = opts.reporter;

  reporter?.onStatus({ status: "running" });

  // LFS is a repo-level artifact — resolve the enclosing git repo root. A
  // non-git target is a clean skip (same rule as gitexclude), never a failure.
  const repoRoot = await getRepoRoot(target);
  if (!repoRoot) {
    reporter?.onStatus({ status: "skipped", detail: "no git repo" });
    return;
  }

  const gitattributesPath = path.join(repoRoot, ".gitattributes");
  const hasGitLfs = await detectGitLfs();

  // Dry-run previews the intent without failing on a missing binary — no writes,
  // never exit 1. Note the missing binary so the user knows a real run needs it.
  if (dryRun) {
    const note = hasGitLfs ? "" : " (git-lfs not installed — brew install git-lfs)";
    reporter?.onStatus({
      status: "done",
      detail: `would git lfs install --local + track block in ${path.basename(repoRoot)}/.gitattributes${note}`,
    });
    return;
  }

  // Real run: `git lfs install` needs the git-lfs binary. Missing → fail loudly
  // with the fix in hand; the caller surfaces this as a failed step (exit 1).
  if (!hasGitLfs) {
    throw new Error("git-lfs not installed — brew install git-lfs");
  }

  await gitLfsInstallLocal(repoRoot);
  const result = await writeLfsAttributes({ gitattributesPath });

  reporter?.onStatus({
    status: "done",
    detail: result.written
      ? "git lfs install + .gitattributes synced"
      : "git lfs install (.gitattributes up to date)",
  });
}
