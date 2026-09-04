/**
 * commands/mcp.ts — `scvn mcp <verb>` — vendor Unity-MCP as Assets/ source.
 *
 *   status     what is staged, and which projects have it installed (offline)
 *   install    vendor into a project + write .mcp.json
 *   uninstall  remove local Unity-MCP packages (+ optionally the NuGet DLLs)
 *   update     update local Unity-MCP packages (an older version = offline rollback)
 *   reconfigure  change an installed project's addon set atomically
 *
 * Bare `scvn mcp` prints the usage hint and exits 1 — the `scvn git` precedent,
 * not the `scvn packages` verb menu. The mutating verbs each target a specific
 * project, so there is no safe default to guess.
 */

import process from "node:process";
import path from "node:path";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { selectSetupTarget } from "./shared/select-setup-target.js";
import { selectMcpAddons } from "./shared/select-mcp-addons.js";
import { getProjectsRoot } from "./shared/project-discovery.js";
import { runStep } from "./shared/step-runner.js";
import { autoConfirm } from "../features/transfer/reporter.js";
import { getMcpStatus, renderMcpStatus } from "../features/mcp/status-mcp.js";
import { writeCacheDir } from "../features/mcp/resolve-mcp-cache.js";
import type { McpAgentId } from "../features/mcp/upstream.js";
import { PROJECT_LOCAL_AGENTS, removeMcpPlugin, runMcpLifecycle } from "../features/mcp/upstream.js";

export type McpVerb = "status" | "install" | "uninstall" | "update" | "reconfigure" | "skills" | "finish";

const VERBS = new Set<string>(["status", "install", "uninstall", "update", "reconfigure", "skills", "finish"]);

export const MCP_USAGE_HINT = `scvn mcp needs a verb:
  scvn mcp status                                      staged versions + per-project install state (offline)
  scvn mcp install [<coreVer>] [--addons a,b]         vendor packages and write the selected agent config
  scvn mcp uninstall [--purge-nuget]                  remove local Unity-MCP packages
  scvn mcp update [<coreVer>]                          update an installed project (older version = rollback)
  scvn mcp reconfigure [--addons a,b]                 re-vendor an installed project with a new extension set
  scvn mcp skills [--agent <id>]                       generate skills after opening the Unity project
  scvn mcp finish [--agent <id>]                       open the Unity project, wait for the plugin, generate skills
Options: --agent <id>, --enable-all-tools/prompts/resources (each defaults on)
Target: --target <Assets dir> | SCVN_TARGET | interactive picker (-y requires an explicit target).`;

function parseAgent(value: string | undefined): McpAgentId | undefined {
  if (value === undefined) return undefined;
  const agent = PROJECT_LOCAL_AGENTS.find((candidate) => candidate.value === value);
  if (!agent) throw new Error(`Unsupported project-local MCP agent: ${value}`);
  return agent.value;
}

export interface McpCommandArgs {
  verb?: string;
  /** Positional after the verb — `install <coreVer>` / `update <coreVer>`. */
  version?: string;
  target?: string;
  addons?: string;
  throwOnFailure?: boolean;
  agent?: string;
  enableAllTools?: boolean;
  enableAllPrompts?: boolean;
  enableAllResources?: boolean;
  force?: boolean;
  purgeNuget?: boolean;
  dryRun?: boolean;
  autoYes?: boolean;
}

export async function runMcp(
  args: McpCommandArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  const verb = args.verb;
  const agent = parseAgent(args.agent);

  if (!verb || !VERBS.has(verb)) {
    if (verb) console.error(`Unknown mcp subcommand: ${verb}\n`);
    console.error(MCP_USAGE_HINT);
    process.exitCode = 1;
    return;
  }

  if (verb === "status") {
    await runStatus();
    return;
  }

  let addons: string[] | undefined;
  // Only an install with typed --addons is a hard requirement. Reconfigure
  // remains strict in its owner even when the list came from the picker.
  const addonsRequired = verb === "install" && args.addons !== undefined;
  if (args.addons !== undefined) {
    addons = args.addons.split(",").map((part) => part.trim()).filter(Boolean);
  }

  output.intro(`scvn mcp ${verb}`);

  // Target resolution: --target → SCVN_TARGET → picker. Never auto-picked under
  // -y (parity with every other mutating flow).
  const preset = args.target || process.env["SCVN_TARGET"] || null;
  if (!preset && args.autoYes) {
    output.log.error("--yes requires an explicit target: pass --target <Assets dir> or set SCVN_TARGET");
    process.exitCode = 1;
    output.outro(`mcp ${verb}: aborted`);
    return;
  }
  const target = preset ?? (await selectSetupTarget(prompt, output));

  // Interactive install with no --addons: offer the picker. Under -y there is no
  // menu to open, so leave the set UNRESOLVED and let install decide: adopt what
  // is already staged (a bundle), or fetch the default seed when nothing is.
  // Materializing the seed here would look like a typed --addons and force a
  // fetch on exactly the machine that cannot do one.
  if ((verb === "install" || verb === "reconfigure") && addons === undefined && !args.autoYes) {
    addons = await selectMcpAddons(prompt);
  }

  const dryRun = args.dryRun ?? false;
  const outcome = await runStep(
    {
      key: verb,
      label: `mcp ${verb}  ${path.basename(path.dirname(target))}`,
      dryRun,
      run: (reporter) => {
        if (verb === "uninstall") {
          return removeMcpPlugin({ target, dryRun, purgeNuget: args.purgeNuget, reporter });
        }
        return (async () => {
          await runMcpLifecycle({
            target,
            verb: verb as "install" | "update" | "reconfigure" | "skills" | "finish",
            extensions: addons,
            addonsRequired,
            agent,
            pluginVersion: args.version,
            enableAllTools: args.enableAllTools ?? true,
            enableAllPrompts: args.enableAllPrompts ?? true,
            enableAllResources: args.enableAllResources ?? true,
            force: args.force,
            dryRun,
            reporter,
          });
        })();
      },
    },
    prompt,
    autoConfirm,
    output,
  );

  if (outcome === "failed") {
    if (args.throwOnFailure) throw new Error(`mcp ${verb} failed`);
    process.exitCode = 1;
    return;
  }
  output.outro(dryRun ? `mcp ${verb}: dry-run complete (no writes)` : `mcp ${verb}: done`);
}

/** Offline state screen. No spinner, no network — just print. */
async function runStatus(): Promise<void> {
  const status = await getMcpStatus({
    projectsRoot: await getProjectsRoot(),
    userCacheDir: writeCacheDir(),
  });
  for (const line of renderMcpStatus(status)) {
    console.log(line);
  }
}
