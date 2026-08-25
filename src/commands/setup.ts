/**
 * commands/setup.ts — Linear clack flow for the project-bootstrap op:
 * `scvn ignore-dirty`.
 *
 * v0.3: each op is a first-class command. There is no setup namespace, no
 * operation menu, and no run-all orchestrator. `scvn fork` is a sibling
 * command (commands/fork.ts) and never enters this module. `scvn gitignore` /
 * `scvn gitexclude` were grouped into `scvn git` in v0.5 (commands/git.ts) —
 * their handlers still live in features/setup but no longer route here.
 *
 * Flow:
 *   1. Resolve target: --target flag → SCVN_TARGET env → clack select.
 *      Under --yes an explicit target is REQUIRED — fail loudly instead of
 *      auto-picking a project (parity with the import --to safety rule).
 *   2. spinner.start → handler with reporter → spinner.stop → outro.
 *
 * Flags:
 *   -y / autoYes      — skip prompts (explicit target then required)
 *   -n / dryRun       — pass through to handlers (no writes), dry-run label
 *   --target <path>   — target project (Assets dir)
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter, SpinnerHandle } from "../ui/prompt.js";
import { selectSetupTarget } from "./shared/select-setup-target.js";
import { buildSetupHandlers } from "../features/setup/index.js";
import type { SyncReporter, SyncStatusEvent, SyncLogEntry } from "../features/transfer/reporter.js";
import type { SubmoduleConfirm } from "../features/setup/toggle-submodule-ignore.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The bootstrap op handled by this module (fork lives in fork.ts).
 * gitignore/gitexclude moved to `scvn git` in v0.5.
 */
export type SetupOp = "ignore-dirty";

export interface SetupOpArgs {
  target?:  string;   // --target flag value (falls back to SCVN_TARGET env)
  dryRun?:  boolean;
  autoYes?: boolean;
}

// ---------------------------------------------------------------------------
// Reporter → spinner bridge
// ---------------------------------------------------------------------------

function buildReporter(
  label: string,
  spinner: SpinnerHandle,
  output: OutputAdapter,
): SyncReporter & { lastDetail: string } {
  let lastDetail = "";

  return {
    get lastDetail() { return lastDetail; },

    onStatus(event: SyncStatusEvent): void {
      lastDetail = event.detail ?? event.error ?? "";
      if (event.status === "running" && event.detail) {
        spinner.message(`${label}  ${event.detail}`);
      }
    },

    onProgress(): void {
      // setup ops do not produce rsync progress — no-op
    },

    onLog(entry: SyncLogEntry): void {
      if (entry.level === "warn")       output.log.warn(entry.message);
      else if (entry.level === "error") output.log.error(entry.message);
      else                              output.log.step(entry.message);
    },
  };
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

interface StepSpec {
  label:  string;
  dryRun: boolean;
  run:    (reporter: SyncReporter) => Promise<void>;
}

async function runStep(step: StepSpec, prompt: PromptAdapter, output: OutputAdapter): Promise<boolean> {
  const stepLabel = step.dryRun ? `${step.label}  [dry-run]` : step.label;
  const spinner   = prompt.spinner();
  spinner.start(stepLabel);

  const reporter = buildReporter(stepLabel, spinner, output);

  try {
    await step.run(reporter);
    const detail = reporter.lastDetail;
    spinner.stop(detail ? `${stepLabel}  ${detail}` : stepLabel);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.stop(`${stepLabel}  failed: ${message}`, 1);
    output.log.error(`${step.label} failed: ${message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const OP_LABELS: Record<SetupOp, string> = {
  "ignore-dirty": "Submodule ignore-dirty",
};

/**
 * Run a single bootstrap op as a linear clack flow.
 *
 * Accepts an optional `prompt` override for testing (fake adapter).
 */
export async function runSetupOp(
  op: SetupOp,
  args: SetupOpArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;

  output.intro(`scvn ${op}`);

  // -------------------------------------------------------------------------
  // Resolve target: flag → env → interactive (never auto-pick under --yes).
  // Truthy chain on purpose: an empty --target/SCVN_TARGET value must fall
  // through to the picker, not silently resolve to cwd-relative paths.
  // -------------------------------------------------------------------------
  const preset = args.target || process.env["SCVN_TARGET"] || null;

  if (!preset && autoYes) {
    output.log.error("--yes requires an explicit target: pass --target <Assets dir> or set SCVN_TARGET");
    process.exitCode = 1;
    output.outro(`${op}: aborted`);
    return;
  }

  const target = preset ?? await selectSetupTarget(prompt, output);

  // -------------------------------------------------------------------------
  // Multi-select seam for the ignore-dirty submodule picker.
  // autoYes → preselected submodules without a TTY; else clack multiselect.
  // required:false so a deliberate empty submit reaches the handler as
  // "unset all" (the handler treats the submitted Set as the desired final
  // state; cancel/Esc never reaches here — the prompt adapter exits on cancel).
  // -------------------------------------------------------------------------
  const submoduleConfirm: SubmoduleConfirm = autoYes
    ? async (_title, items) =>
        new Set(items.filter((i) => i.preselected).map((i) => i.label))
    : async (title, items) => {
        const selected = await prompt.multiselect({
          message: title,
          options: items.map((i) => ({ value: i.label, label: i.label })),
          initialValues: items.filter((i) => i.preselected).map((i) => i.label),
          required: false,
        });
        return new Set(selected);
      };

  // -------------------------------------------------------------------------
  // Run the single op step. (The gitignore wide-scope prune gate moved to
  // commands/git.ts with the op — ignore-dirty never prunes.)
  // -------------------------------------------------------------------------
  const step: StepSpec = {
    label:  OP_LABELS[op],
    dryRun,
    run: (reporter) =>
      buildSetupHandlers(target, {
        dryRun, autoYes,
        reporter,
        submoduleConfirm,
      })[op]!(),
  };

  const ok = await runStep(step, prompt, output);

  if (!ok) {
    process.exitCode = 1;
    output.outro(`${op}: completed with errors`);
  } else {
    output.outro(dryRun ? `${op}: dry-run complete (no writes)` : `${op}: done`);
  }
}
