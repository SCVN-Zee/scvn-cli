/**
 * commands/shared/select-source-project.ts — Export-side source selection.
 *
 * Visible-with-default: the select prompt is preselected (cursor) on the
 * remembered source — store meta first, then history — but the user always
 * SEES the choice. This replaces the v0.1 behavior where a history preset
 * silently bypassed the prompt with no way to change it.
 *
 * Resolution order:
 *   1. `--from` flag → used directly (logged for visibility)
 *   2. autoYes → preferred (store meta) → history.src → first discovered,
 *      logged via log.step; nothing discovered → text prompt fires anyway
 *   3. Interactive → select with initialValue preselect; empty discover →
 *      text prompt fallback
 */

import type { PromptAdapter } from "../../ui/prompt.js";
import type { OutputAdapter } from "../../ui/output.js";
import { discoverUnityProjects } from "../../services/discover.js";
import { getLastProjectsByRole } from "../../util/history.js";
import { shortenPath } from "../../util/paths.js";
import { getProjectsRoot, projectsToOptions } from "./project-discovery.js";

export interface SelectSourceOpts {
  /** Explicit --from flag value — bypasses discovery entirely */
  from?: string;
  /** Remembered source (store meta.sourcePath) — visible preselect / -y pick */
  preferredPath?: string | null;
  autoYes?: boolean;
}

export async function selectSourceProject(
  prompt: PromptAdapter,
  output: OutputAdapter,
  opts: SelectSourceOpts = {},
): Promise<string> {
  if (opts.from) {
    output.log.step(`source: ${shortenPath(opts.from)}  (--from)`);
    return opts.from;
  }

  const history = await getLastProjectsByRole().catch(() => ({ src: null, target: null }));
  const remembered = opts.preferredPath ?? history.src ?? null;

  // -y with a remembered source: resolve before paying the discovery scan
  if (opts.autoYes && remembered) {
    output.log.step(`source: ${shortenPath(remembered)}  (auto)`);
    return remembered;
  }

  const root     = await getProjectsRoot();
  const projects = await discoverUnityProjects(root);

  if (opts.autoYes) {
    const chosen = projects[0]?.path ?? null;
    if (chosen) {
      output.log.step(`source: ${shortenPath(chosen)}  (auto)`);
      return chosen;
    }
    // Nothing remembered or discovered — ask once even under autoYes
    return prompt.text({ message: "Enter source project (Assets dir) path", kind: "dir" });
  }

  if (projects.length === 0) {
    output.log.warn(`No Unity projects found under ${root} — enter path manually`);
    return prompt.text({ message: "Enter source project (Assets dir) path", kind: "dir" });
  }

  const options = projectsToOptions(projects);
  // Preselect the first remembered path that is actually in the list:
  // store meta source first, then history — each gets its own chance.
  const initialValue = [opts.preferredPath, history.src].find(
    (p): p is string => Boolean(p) && options.some((o) => o.value === p)
  );

  return prompt.select({
    message: "Select source project",
    options,
    initialValue,
  });
}
