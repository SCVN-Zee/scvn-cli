/**
 * commands/git.ts — Linear clack flow for `scvn git` — the flag-selected group
 * of git-artifact bootstrap ops:
 *
 *   scvn git --ignore    install repo-root .gitignore + prune nested
 *   scvn git --exclude   install .git/info/exclude
 *   scvn git --lfs       git lfs install --local + LFS .gitattributes block
 *
 * Flags compose: `scvn git --ignore --exclude --lfs` runs all three under one
 * target resolution and one flow, in the fixed order ignore → exclude → lfs.
 * Bare `scvn git` (no op flag) prints the usage hint and exits 1 — no menu, no
 * run-all. Each op is an independent step; a failing op (e.g. --lfs with git-lfs
 * absent) sets exit 1 but does not abort the ops selected before it.
 *
 * Reuses the shared step-runner + target picker + setup handler map, so the
 * per-op behavior is identical to the standalone `scvn <op>` flows.
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { selectSetupTarget } from "./shared/select-setup-target.js";
import { runStep } from "./shared/step-runner.js";
import type { StepSpec } from "./shared/step-runner.js";
import { autoConfirm } from "../features/transfer/reporter.js";
import { buildSetupHandlers } from "../features/setup/index.js";
import type { WideScopePrune } from "../features/setup/prune-nested-gitignores.js";
import type { WideScopeUntrack } from "../features/setup/untrack-ignored-files.js";

/** The flag-selected git ops. */
export type GitOp = "ignore" | "exclude" | "lfs";

export interface GitCommandArgs {
  ignore?:  boolean;
  exclude?: boolean;
  lfs?:     boolean;
  target?:  string;
  dryRun?:  boolean;
  autoYes?: boolean;
}

/** git flag → the setup handler key it dispatches to. */
const HANDLER_KEY: Record<GitOp, string> = {
  ignore:  "gitignore",
  exclude: "gitexclude",
  lfs:     "lfs",
};

const OP_LABELS: Record<GitOp, string> = {
  ignore:  ".gitignore",
  exclude: ".git/info/exclude",
  lfs:     "Git LFS",
};

/** Fixed run order when multiple flags are passed. */
const OP_ORDER: GitOp[] = ["ignore", "exclude", "lfs"];

export const GIT_USAGE_HINT = `scvn git needs at least one op flag:
  scvn git --ignore    install repo-root .gitignore + prune nested
  scvn git --exclude   install .git/info/exclude
  scvn git --lfs       git lfs install --local + LFS .gitattributes block
Combine them: scvn git --ignore --exclude --lfs [--target <Assets dir>] [-n] [-y]`;

/**
 * Run the `scvn git` flow. Accepts an optional `prompt` override for testing.
 */
export async function runGitCommand(
  args: GitCommandArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;

  const ops = OP_ORDER.filter((op) => args[op]);

  // No op selected — print the flag hint and fail loudly. No target resolution,
  // no writes, no menu (bare `scvn git` is a usage nudge, not a run-all).
  if (ops.length === 0) {
    console.error(GIT_USAGE_HINT);
    process.exitCode = 1;
    return;
  }

  output.intro("scvn git");

  // Target resolution: --target flag → SCVN_TARGET env → interactive picker.
  // Never auto-pick under --yes (parity with the import --to safety rule).
  const preset = args.target || process.env["SCVN_TARGET"] || null;
  if (!preset && autoYes) {
    output.log.error("--yes requires an explicit target: pass --target <Assets dir> or set SCVN_TARGET");
    process.exitCode = 1;
    output.outro("git: aborted");
    return;
  }
  const target = preset ?? await selectSetupTarget(prompt, output);

  // Wide-scope prune gate (gitignore) — reached only when the enclosing git repo
  // is ABOVE the target project. Same seam as the standalone gitignore flow.
  const pruneConfirm = ({ repoRoot, projectRoot, count }: WideScopePrune) =>
    prompt.confirm({
      message:
        `Prune ${count} nested .gitignore across ${repoRoot}?\n` +
        `That repo is ABOVE the target project (${projectRoot}) — files outside the project may be deleted.`,
      initialValue: false,
    });

  // Wide-scope untrack gate (gitignore) — reached only when the enclosing git
  // repo is ABOVE the target project, same seam as the prune gate.
  const untrackConfirm = ({ repoRoot, projectRoot, count }: WideScopeUntrack) =>
    prompt.confirm({
      message:
        `Untrack ${count} already-tracked file(s) now ignored, across ${repoRoot}?\n` +
        `That repo is ABOVE the target project (${projectRoot}) — files outside the project may be removed from the index (kept on disk).`,
      initialValue: false,
    });

  let anyFailed = false;
  for (const op of ops) {
    const step: StepSpec = {
      key:    op,
      label:  OP_LABELS[op],
      dryRun,
      run: (reporter) =>
        buildSetupHandlers(target, { dryRun, autoYes, reporter, pruneConfirm, untrackConfirm })[HANDLER_KEY[op]]!(),
    };
    const outcome = await runStep(step, prompt, autoConfirm, output);
    if (outcome === "failed") anyFailed = true;
  }

  if (anyFailed) {
    process.exitCode = 1;
    output.outro("git: completed with errors");
  } else {
    output.outro(dryRun ? "git: dry-run complete (no writes)" : "git: done");
  }
}
