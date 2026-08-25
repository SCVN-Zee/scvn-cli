/**
 * commands/config.ts — Interactive flow for `scvn config`.
 *
 * Prompts for each setting and writes ~/.scvn/config via saveConfig. The config
 * model currently holds a single user-facing field: the Unity projects root
 * (SCVN_PROJECTS_ROOT).
 *
 * TTY: prompt the projects root (prefilled with the current value), expand ~,
 * re-prompt until the path is an existing directory, then save.
 *
 * Non-TTY / CI: cannot prompt — seed the file from a default template if missing,
 * print the resolved path + a hint, exit cleanly (no hang). Safe for pipes/CI.
 *
 * The prompt adapter and dir-exists check are injectable so unit tests run
 * without a real TTY or filesystem traversal.
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { expandHome } from "../lib/path-expand.js";
import { exists, isDir as realIsDir } from "../util/fs-predicates.js";
import { getConfigPath } from "../config/paths.js";
import { loadConfig } from "../config/load.js";
import { saveConfig } from "../config/save.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunConfigDeps {
  /** Prompt adapter — default realPrompt (clack-backed TTY prompts). */
  prompt?: PromptAdapter;
  /** Dir-exists predicate — default fs-predicates isDir. */
  isDir?: (path: string) => Promise<boolean>;
  /** Override config file path for testing. */
  configPath?: string;
  /**
   * Whether to run interactively (prompt) vs seed-and-print. Defaults to
   * `process.stdin.isTTY`. The desktop GUI passes `true` so it always prompts
   * (the utility process has no TTY, but a real UI is present).
   */
  isTTY?: boolean;
  /** Output adapter — default realOutput (clack-backed TTY logs). */
  output?: OutputAdapter;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Parameters for the config write half (shared by CLI and GUI form). */
export interface ConfigExecuteParams {
  projectsRoot: string;
}

/** Outcome of the config write. */
export interface ConfigExecuteResult {
  ok: boolean;
  error?: string;
}

/**
 * Validate + persist the Unity projects root. The destructive half of
 * `scvn config`, shared by the CLI loop and the desktop native form (which
 * gathers the path via a folder picker). Trims + home-expands, checks the dir
 * exists, writes, and logs success/outro. Never prompts.
 */
export async function runConfigExecute(
  params: ConfigExecuteParams,
  deps: { configPath?: string; output?: OutputAdapter; isDir?: (path: string) => Promise<boolean> } = {},
): Promise<ConfigExecuteResult> {
  const configPath = getConfigPath(deps.configPath);
  const output = deps.output ?? realOutput;
  const isDir = deps.isDir ?? realIsDir;
  const projectsRoot = expandHome(params.projectsRoot.trim());

  if (!projectsRoot) {
    output.log.error("Path is required");
    return { ok: false, error: "Path is required" };
  }
  if (!(await isDir(projectsRoot))) {
    const error = `${projectsRoot} is not an existing directory`;
    output.log.error(error);
    return { ok: false, error };
  }

  try {
    await saveConfig({ projectsRoot }, { configPath });
  } catch (err) {
    output.log.error(`Failed to save config: ${String(err)}`);
    return { ok: false, error: String(err) };
  }

  output.log.success(`SCVN_PROJECTS_ROOT=${projectsRoot}`);
  output.outro(configPath);
  return { ok: true };
}

/**
 * Run the config command: prompt each setting and persist to ~/.scvn/config.
 *
 * Non-TTY path: seed the file if missing, print the resolved path + a hint, no hang.
 */
export async function runConfig(deps: RunConfigDeps = {}): Promise<void> {
  const configPath = getConfigPath(deps.configPath);
  const prompt = deps.prompt ?? realPrompt;
  const isDir = deps.isDir ?? realIsDir;
  const output = deps.output ?? realOutput;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);

  // Non-TTY context: cannot prompt — seed file if missing, print path + hint.
  if (!isTTY) {
    if (!(await exists(configPath))) {
      try {
        await saveConfig({}, { configPath });
      } catch (err) {
        output.log.error(`Failed to create config file: ${String(err)}`);
        process.exitCode = 1;
        return;
      }
    }
    output.intro("scvn config");
    output.log.info(`Config path: ${configPath}`);
    output.log.step("Run in an interactive terminal to edit, or edit the file manually:");
    output.outro(configPath);
    return;
  }

  // Interactive: prompt each setting (prefilled with current), validate, save.
  const current = await loadConfig({ configPath });

  output.intro("scvn config");

  // Loop the dir-exists check in application code — clack's validate is
  // synchronous and cannot await stat (mirrors the fork.ts scan-root prompt).
  let projectsRoot: string;
  for (;;) {
    const answer = (await prompt.text({
      message:      "Unity projects root",
      placeholder:  "/path/to/your/Unity/Projects",
      defaultValue: current.projectsRoot,
      validate:     (value) => (value.trim() ? undefined : "Path is required"),
      kind:         "dir",
    })).trim();
    projectsRoot = expandHome(answer);
    if (await isDir(projectsRoot)) break;
    output.log.warn(`${projectsRoot} is not an existing directory — enter a valid path`);
  }

  try {
    await saveConfig({ projectsRoot }, { configPath });
  } catch (err) {
    output.log.error(`Failed to save config: ${String(err)}`);
    process.exitCode = 1;
    return;
  }

  output.log.success(`SCVN_PROJECTS_ROOT=${projectsRoot}`);
  output.outro(configPath);
}
