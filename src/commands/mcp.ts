/**
 * commands/mcp.ts — `scvn mcp <verb>` — vendor Unity-MCP as Assets/ source.
 *
 *   status     what is staged, and which projects have it installed (offline)
 *   install    vendor into a project + write .mcp.json
 *   uninstall  remove the vendored source (+ optionally the NuGet DLLs)
 *   update     bump an installed project (an older version = offline rollback)
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
import { expandAddonCsv } from "../features/mcp/addon-names.js";
import { installMcp } from "../features/mcp/install-mcp.js";
import { uninstallMcp } from "../features/mcp/uninstall-mcp.js";
import { updateMcp } from "../features/mcp/update-mcp.js";

export type McpVerb = "status" | "install" | "uninstall" | "update";

const VERBS = new Set<string>(["status", "install", "uninstall", "update"]);

export const MCP_USAGE_HINT = `scvn mcp needs a verb:
  scvn mcp status                          staged versions + per-project install state (offline)
  scvn mcp install [<coreVer>] [--addons a,b]  vendor Unity-MCP into a project + write .mcp.json
  scvn mcp uninstall [--purge-nuget]       remove the vendored source
  scvn mcp update [<coreVer>]              bump an installed project (an older version = offline rollback)
Version: omitted → the newest core every selected addon has a build for. Name one to override.
Target: --target <Assets dir> | SCVN_TARGET | interactive picker (-y requires an explicit --target).`;

export interface McpCommandArgs {
  verb?: string;
  /** Positional after the verb — `install <coreVer>` / `update <coreVer>`. */
  version?: string;
  target?: string;
  addons?: string;
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
  // A TYPED --addons is a requirement; anything else (the seed, the picker) is a
  // preference that may degrade to the cached set on an offline machine.
  const addonsRequired = args.addons !== undefined;
  if (args.addons !== undefined) {
    addons = expandAddonCsv(args.addons);
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
  if (verb === "install" && addons === undefined && !args.autoYes) {
    addons = await selectMcpAddons(prompt);
  }

  const dryRun = args.dryRun ?? false;
  const outcome = await runStep(
    {
      key: verb,
      label: `mcp ${verb}  ${path.basename(path.dirname(target))}`,
      dryRun,
      run: (reporter) => {
        const shared = { target, cacheDir: writeCacheDir(), dryRun, reporter };
        if (verb === "uninstall") {
          return uninstallMcp({ ...shared, purgeNuget: args.purgeNuget ?? false });
        }
        if (verb === "update") {
          return updateMcp({
            ...shared,
            coreVersion: args.version,
            addons,
            force: args.force ?? false,
          });
        }
        return installMcp({
          ...shared,
          addons,
          addonsRequired,
          coreVersion: args.version,
          force: args.force ?? false,
        });
      },
    },
    prompt,
    autoConfirm,
    output,
  );

  if (outcome === "failed") {
    process.exitCode = 1;
    output.outro(`mcp ${verb}: failed`);
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
