/**
 * commands/shared/project-discovery.ts — Projects-root resolution + picker chrome.
 *
 * resolveProjectsRoot() is the shared resolver (config file → env, home-expanded,
 * or null when unset) used by BOTH the startup first-run guard and getProjectsRoot.
 * getProjectsRoot() is a thin resolver + hard-fail backstop — it never prompts and
 * never writes config. Missing-config handling (launch `scvn config`) lives in the
 * first-run guard; this backstop only fires if a picker is somehow reached with no
 * configured root.
 *
 * projectsToOptions renders discovered projects as clack select options with
 * "name (scene) · branch" labels and an age hint — the shared picker chrome.
 */

import process from "node:process";
import { loadConfig as realLoadConfig } from "../../config/load.js";
import type { ScvnConfig } from "../../config/types.js";
import { expandHome } from "../../lib/path-expand.js";
import type { Project } from "../../services/discover.js";
import type { PromptOption } from "../../ui/prompt.js";
import { ProjectsRootError } from "../../ui/errors.js";

// ---------------------------------------------------------------------------
// Projects-root resolution
// ---------------------------------------------------------------------------

/** Message for the backstop / first-run guard when no projects root is configured. */
export const MISSING_PROJECTS_ROOT_MESSAGE =
  "SCVN_PROJECTS_ROOT is not set or points to a missing directory — run `scvn config`, set the env var, or pass --from/--to/--target";

/**
 * Where a resolved projects root came from. `"env"` means the current
 * SCVN_PROJECTS_ROOT always wins over the saved file value (loadConfig Layer 3)
 * — setup UIs surface that so saving a file path isn't silently ignored.
 */
export type ProjectsRootSource = "file" | "env";

/** resolveProjectsRoot() result: the effective root plus its winning source. */
export interface ResolvedProjectsRoot {
  root: string | null;
  source: ProjectsRootSource | null;
}

/**
 * Resolve the projects root from config file (or SCVN_PROJECTS_ROOT env),
 * home-expanded. Root is null when neither is set (or is whitespace-only).
 * Pure aside from the injected config loader — safe for the guard to call.
 *
 * Source semantics: the current env var always wins, so it is reported as
 * `"env"`. The deprecated SYNC_UNITY_* fallback only fills unset fields — it
 * stops applying the moment a file value is saved — so it cannot override a
 * save and is coalesced into `"file"`.
 */
export async function resolveProjectsRoot(
  loadCfg: () => Promise<ScvnConfig> = realLoadConfig,
): Promise<ResolvedProjectsRoot> {
  const cfg = await loadCfg();
  const envRoot = (process.env["SCVN_PROJECTS_ROOT"] ?? "").trim();
  const raw = envRoot || (cfg.projectsRoot ?? "").trim();
  if (!raw) return { root: null, source: null };
  return { root: expandHome(raw), source: envRoot ? "env" : "file" };
}

function defaultFail(message: string): never {
  throw new ProjectsRootError(message);
}

export interface GetProjectsRootDeps {
  loadConfig?: () => Promise<ScvnConfig>;
  /** Abort the process — never returns. Injectable for tests. */
  fail?: (message: string) => never;
}

/**
 * Resolve the projects root for a picker. Returns the configured/env root
 * (home-expanded). Hard-fails (exit 1) when unset — a backstop; the first-run
 * guard is expected to have caught this earlier for root-needing commands.
 */
export async function getProjectsRoot(deps: GetProjectsRootDeps = {}): Promise<string> {
  const { root } = await resolveProjectsRoot(deps.loadConfig);
  if (root) return root;
  return (deps.fail ?? defaultFail)(MISSING_PROJECTS_ROOT_MESSAGE);
}

// ---------------------------------------------------------------------------
// Picker chrome
// ---------------------------------------------------------------------------

/**
 * Build a clack select option list from discovered Unity projects.
 * Label format: "name (scene) · branch · age" — matches old picker chrome. The
 * "(scene)" part is dropped when the scene equals the project name (a project at
 * its repo root) so the name is not printed twice.
 *
 * When `opts.editorVersion` is given (fork's editor pick), projects whose
 * parsed Unity version differs get a version-mismatch hint prefix.
 *
 * `opts.value: "projectRoot"` picks the option value's path shape — the
 * default `p.path` is the Assets dir (git/setup/mcp), the packages flow keys
 * on the project root.
 */
export function projectsToOptions(
  projects: Project[],
  opts: { editorVersion?: string; value?: "path" | "projectRoot" } = {},
): PromptOption<string>[] {
  return projects.map((p) => {
    const scene = p.scene && p.scene !== p.name ? p.scene : undefined;
    const agePart = formatProjectAge(p.mtimeMs);
    const mismatch =
      opts.editorVersion !== undefined && p.projectVersion !== null && p.projectVersion !== opts.editorVersion
        ? `version mismatch (project ${p.projectVersion}, editor ${opts.editorVersion})`
        : undefined;
    return {
      value: (opts.value ?? "path") === "projectRoot" ? p.projectRoot : p.path,
      label: `${p.name}${scene ? ` (${scene})` : ""}${p.branch ? ` · ${p.branch}` : ""}`,
      hint: mismatch ? `${mismatch} · ${agePart}` : agePart,
    };
  });
}

/**
 * A discovered project split into its display parts, for the desktop picker
 * which renders the name, branch, and age as distinct columns rather than one
 * concatenated string. Same data as {@link projectsToOptions}, unglued.
 */
export interface RichProjectRow {
  /** Absolute Assets path — the select value. */
  value: string;
  /** Repo/project folder name. */
  name: string;
  /** Variant subfolder, only when it differs from the name. */
  scene?: string;
  /** Current git branch, when the project is a git repo. */
  branch?: string;
  /** Human-readable staleness, e.g. "6m ago". */
  age: string;
  /** Editor/project Unity version mismatch detail, when present. */
  mismatch?: string;
}

/** Structured variant of {@link projectsToOptions} for the desktop picker. */
export function projectsToRichRows(
  projects: Project[],
  opts: { editorVersion?: string } = {},
): RichProjectRow[] {
  return projects.map((p) => ({
    value: p.path,
    name: p.name,
    scene: p.scene && p.scene !== p.name ? p.scene : undefined,
    branch: p.branch ?? undefined,
    age: formatProjectAge(p.mtimeMs),
    mismatch:
      opts.editorVersion !== undefined && p.projectVersion !== null && p.projectVersion !== opts.editorVersion
        ? `version mismatch (project ${p.projectVersion}, editor ${opts.editorVersion})`
        : undefined,
  }));
}

/**
 * Format an mtime as "<n>m/h/d ago" — the shared picker staleness chrome.
 * Names the minute/hour/day (60/1440) ladder so both picker builders agree.
 */
function formatProjectAge(mtimeMs: number): string {
  const ageMin = Math.round((Date.now() - mtimeMs) / 60_000);
  return ageMin < 60
    ? `${ageMin}m ago`
    : ageMin < 1440
      ? `${Math.floor(ageMin / 60)}h ago`
      : `${Math.floor(ageMin / 1440)}d ago`;
}
