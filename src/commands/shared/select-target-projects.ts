/**
 * commands/shared/select-target-projects.ts — Import-side target selection.
 *
 * Imports apply to exactly ONE project (the DESTRUCTIVE side — imports overwrite
 * project content), so:
 *   - the picker is a single-select, never prefilled (conscious selection),
 *   - the source project is filtered out of the list,
 *   - `--to` takes a single path; passing 2+ is a usage error (imports never
 *     fan out to multiple projects),
 *   - autoYes without explicit --to is a usage error — v0.1's silent
 *     "first discovered project" auto-pick overwrote whatever project was
 *     most recently modified, and that behavior is deliberately not kept.
 *
 * Returns a one-element array so the import call sites keep their existing
 * per-target loop + summary shape unchanged.
 */

import type { PromptAdapter } from "../../ui/prompt.js";
import type { OutputAdapter } from "../../ui/output.js";
import { discoverUnityProjects } from "../../services/discover.js";
import { getProjectsRoot, projectsToOptions } from "./project-discovery.js";

/** Thrown for operator errors that should print + exit 1 without a stack. */
export class UsageError extends Error {}

export interface SelectTargetsOpts {
  /** Explicit --to flag value — a single path; 2+ is a usage error */
  to?: string[];
  /** Paths filtered out of the choices (the staged source project(s)) */
  excludePaths?: Array<string | null | undefined>;
  autoYes?: boolean;
}

export async function selectTargetProjects(
  prompt: PromptAdapter,
  output: OutputAdapter,
  opts: SelectTargetsOpts = {},
): Promise<string[]> {
  if (opts.to && opts.to.length > 0) {
    if (opts.to.length > 1) {
      throw new UsageError("import applies to one project — pass a single --to <path>");
    }
    return opts.to;
  }

  if (opts.autoYes) {
    throw new UsageError("--yes import requires explicit --to <path> (refusing to auto-pick an overwrite target)");
  }

  const excluded = new Set((opts.excludePaths ?? []).filter(Boolean));
  const root     = await getProjectsRoot();
  const projects = (await discoverUnityProjects(root))
    .filter((p) => !excluded.has(p.path));

  if (projects.length === 0) {
    output.log.warn(`No Unity projects found under ${root} — enter path manually`);
    const single = await prompt.text({ message: "Enter target project (Assets dir) path", kind: "dir" });
    return [single];
  }

  const chosen = await prompt.select({
    message: "Select target project",
    options: projectsToOptions(projects),
  });
  return [chosen];
}
