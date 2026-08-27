/**
 * commands/init.ts — Interactive and scriptable `scvn init` flow.
 */

import { readFile } from "node:fs/promises";
import process from "node:process";
import { createDefaultInitLayout, initializeProject, type InitLayout, type InitResult } from "../features/init/index.js";
import { realOutput, type OutputAdapter } from "../ui/output.js";
import { realPrompt, type PromptAdapter } from "../ui/prompt.js";

export interface InitCommandArgs {
  target?: string;
  name?: string;
  layout?: string;
  dryRun?: boolean;
  autoYes?: boolean;
}

async function readLayout(filePath: string): Promise<InitLayout> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as InitLayout;
}

function printResult(result: InitResult, output: OutputAdapter): void {
  output.log.info(`Assets hierarchy: ${result.hierarchyRoot}`);
  for (const entry of result.entries) {
    const label = result.dryRun ? "would create" : entry.status;
    output.log.step(`${label}: ${entry.path}`);
  }
}

/** Run the CLI flow; all validation and filesystem behavior lives in the feature core. */
export async function runInit(
  args: InitCommandArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  output.intro("scvn init");
  const presetTarget = args.target || process.env["SCVN_TARGET"] || null;
  if (!presetTarget && args.autoYes) {
    output.log.error("--yes requires an explicit target: pass --target <Assets dir> or set SCVN_TARGET");
    process.exitCode = 1;
    output.outro("init: aborted");
    return;
  }

  const targetAssets = presetTarget ?? await prompt.text({
    message: "Unity Assets directory",
    placeholder: "/path/to/your/Unity/Assets",
    kind: "dir",
  });
  if (args.layout && args.name) {
    output.log.error("--name cannot be combined with --layout; custom layouts contain full Assets-relative paths");
    process.exitCode = 1;
    output.outro("init: aborted");
    return;
  }
  if (!args.layout && !args.name && args.autoYes) {
    output.log.error("--yes requires --name when --layout is not supplied");
    process.exitCode = 1;
    output.outro("init: aborted");
    return;
  }

  try {
    const layout = args.layout
      ? await readLayout(args.layout)
      : createDefaultInitLayout(args.name ?? await prompt.text({
        message: "Supercent project directory name",
        placeholder: "ProjectName",
      }));
    const result = await initializeProject(
      { targetAssets, layout },
      { dryRun: args.dryRun },
    );
    printResult(result, output);
    output.log.success(result.dryRun ? "Dry run complete" : "Project directories ready");
    output.outro(result.hierarchyRoot);
  } catch (error) {
    output.log.error(String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
    output.outro("init: failed");
  }
}
