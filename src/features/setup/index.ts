/**
 * features/setup/index.ts — Handler map for the project-bootstrap ops.
 *
 * buildSetupHandlers(target, opts) → Record<string, () => Promise<void>>
 *
 * One key per direct command: ignore-dirty, gitignore, gitexclude, lfs.
 * Fork routing is NOT part of this map — cli.tsx dispatches
 * `scvn fork` straight to commands/fork.ts.
 *
 * gitexclude has its own handler (fenced block write) rather than the generic
 * template copy — `.git/info/exclude` is shared with other writers.
 */

import { setupTemplate, setupTemplates } from "./setup-templates.js";
import type { SetupTemplateOpts } from "./setup-templates.js";
import { pruneNestedGitignores } from "./prune-nested-gitignores.js";
import type { PruneNestedGitignoresOpts } from "./prune-nested-gitignores.js";
import { untrackIgnoredFiles } from "./untrack-ignored-files.js";
import type { UntrackIgnoredFilesOpts } from "./untrack-ignored-files.js";
import { toggleSubmoduleIgnore } from "./toggle-submodule-ignore.js";
import type { ToggleSubmoduleIgnoreOpts, SubmoduleConfirm } from "./toggle-submodule-ignore.js";
import { setupLfs } from "./setup-lfs.js";
import { setupGitexclude } from "./setup-gitexclude.js";

export type { SetupTemplateOpts, ToggleSubmoduleIgnoreOpts };

export interface SetupHandlerOpts {
  dryRun?:      boolean;
  autoYes?:     boolean;
  reporter?:    ToggleSubmoduleIgnoreOpts["reporter"];
  /** Multi-select gate for the ignore-dirty submodule picker. Required unless autoYes=true. */
  submoduleConfirm?: SubmoduleConfirm;
  /** Wide-scope confirm for gitignore prune — reached only when the repo root is above the project. */
  pruneConfirm?: PruneNestedGitignoresOpts["confirmWideScope"];
  /** Wide-scope confirm for ignore-time untrack — reached only when the repo root is above the project. */
  untrackConfirm?: UntrackIgnoredFilesOpts["confirmWideScope"];
}

export function buildSetupHandlers(
  target: string,
  opts: SetupHandlerOpts = {},
): Record<string, () => Promise<void>> {
  return {
    "ignore-dirty": () => toggleSubmoduleIgnore(target, {
      autoYes:  opts.autoYes,
      dryRun:   opts.dryRun,
      reporter: opts.reporter,
      confirm:  opts.submoduleConfirm,
    }),
    gitignore:    async () => {
      // Install/refresh the repo-root .gitignore, prune every OTHER one, then
      // untrack files the freshly written rules now ignore (index-only).
      await setupTemplate(target, "gitignore", { dryRun: opts.dryRun, reporter: opts.reporter });
      await pruneNestedGitignores(target, {
        dryRun:           opts.dryRun,
        autoYes:          opts.autoYes,
        reporter:         opts.reporter,
        confirmWideScope: opts.pruneConfirm,
      });
      await untrackIgnoredFiles(target, {
        dryRun:           opts.dryRun,
        autoYes:          opts.autoYes,
        reporter:         opts.reporter,
        confirmWideScope: opts.untrackConfirm,
      });
    },
    gitexclude:   () => setupGitexclude(target, { dryRun: opts.dryRun, reporter: opts.reporter }),
    lfs:          () => setupLfs(target, { dryRun: opts.dryRun, reporter: opts.reporter }),
  };
}

// Re-export so callers can import the batch template wrapper directly if needed.
export { setupTemplates };
