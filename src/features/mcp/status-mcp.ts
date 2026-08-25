/**
 * features/mcp/status-mcp.ts — What is staged, and which projects have it installed.
 *
 * STRICTLY OFFLINE. It never resolves a registry version, so it works on a plane
 * and answers in well under a second. That is a deliberate constraint, not an
 * accident: status is for orientation, and orientation that hangs on a network
 * timeout is useless.
 *
 * Ports `render_state` (unity-mcp-localize.sh:549), with scvn's project
 * discovery in place of the script's `luna_*` glob.
 */

import { discoverUnityProjects } from "../../services/discover.js";
import { listStagedVersions } from "./resolve-mcp-cache.js";
import type { McpCacheOpts, StagedVersion } from "./resolve-mcp-cache.js";
import { isInstalled, markerVersion } from "./marker.js";

export interface McpProjectState {
  name: string;
  /** The Unity project dir (parent of Assets/). */
  projectRoot: string;
  installed: boolean;
  /** Installed core version, or null when not installed. */
  version: string | null;
}

export interface McpStatus {
  versions: StagedVersion[];
  projects: McpProjectState[];
}

export interface StatusOpts extends McpCacheOpts {
  /** Unity projects root to scan. */
  projectsRoot: string;
}

/** Staged versions + per-project install state. No network. */
export async function getMcpStatus(opts: StatusOpts): Promise<McpStatus> {
  const [versions, discovered] = await Promise.all([
    listStagedVersions(opts),
    discoverUnityProjects(opts.projectsRoot),
  ]);

  const projects: McpProjectState[] = [];
  for (const project of discovered) {
    const installed = await isInstalled(project.projectRoot);
    projects.push({
      name: project.name,
      projectRoot: project.projectRoot,
      installed,
      version: installed ? await markerVersion(project.projectRoot) : null,
    });
  }

  return { versions, projects };
}

/** Render the status as the lines `scvn mcp status` prints. */
export function renderMcpStatus(status: McpStatus): string[] {
  const lines: string[] = [];

  if (status.versions.length === 0) {
    lines.push("staged versions:  (none — run scvn mcp install)");
  } else {
    status.versions.forEach((staged, index) => {
      const label = index === 0 ? "staged versions:" : "";
      const tag = staged.source === "bundled" ? "  (bundled)" : "";
      lines.push(`${label.padEnd(17)} V${staged.version}${tag}`);
    });
  }

  if (status.projects.length === 0) {
    lines.push("projects:         (none found)");
    return lines;
  }

  lines.push("");
  for (const project of status.projects) {
    const state = project.installed
      ? `installed v${project.version ?? "?"}`
      : "not installed";
    lines.push(`${project.name.padEnd(24)} ${state}`);
  }
  return lines;
}
