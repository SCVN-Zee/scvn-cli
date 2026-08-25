/**
 * commands/shared/select-setup-target.ts — Interactive target-project picker
 * shared by the bootstrap-op flows (`scvn <op>` in setup.ts and `scvn git`).
 *
 * Only reached when no --target flag / SCVN_TARGET env preset exists. Resolves
 * the projects root, discovers Unity projects, and offers a single-select — or
 * a manual text prompt when none are discovered.
 */

import { discoverUnityProjects } from "../../services/discover.js";
import { getProjectsRoot, projectsToOptions, projectsToRichRows } from "./project-discovery.js";
import type { RichProjectRow } from "./project-discovery.js";
import type { PromptAdapter, PromptOption } from "../../ui/prompt.js";
import type { OutputAdapter } from "../../ui/output.js";

/** The discovered setup targets: the resolved root and select-ready options. */
export interface SetupTargets {
  root: string;
  projects: PromptOption<string>[];
}

/**
 * Resolve the projects root and discover Unity projects under it, mapped to
 * select options. Pure aside from fs — shared by the CLI picker and the
 * desktop form's prepare step so both offer the same target list.
 */
export async function discoverSetupTargets(): Promise<SetupTargets> {
  const root = await getProjectsRoot();
  const projects = await discoverUnityProjects(root);
  return { root, projects: projectsToOptions(projects) };
}

/** The resolved root plus discovered projects as structured rows for the desktop picker. */
export interface RichSetupTargets {
  root: string;
  projects: RichProjectRow[];
}

/**
 * Same discovery as {@link discoverSetupTargets}, but returns each project as
 * structured display parts (name / branch / age) so the desktop picker can lay
 * them out as distinct columns instead of one glued string.
 */
export async function discoverSetupTargetsRich(): Promise<RichSetupTargets> {
  const root = await getProjectsRoot();
  const projects = await discoverUnityProjects(root);
  return { root, projects: projectsToRichRows(projects) };
}

export async function selectSetupTarget(prompt: PromptAdapter, output: OutputAdapter): Promise<string> {
  const { root, projects } = await discoverSetupTargets();

  if (projects.length === 0) {
    output.log.warn(`No Unity projects found under ${root} — enter path manually`);
    return prompt.text({ message: "Enter target project (Assets dir) path", kind: "dir" });
  }

  return prompt.select({
    message: "Select target project",
    options: projects,
  });
}
