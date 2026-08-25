/**
 * commands/shared/step-runner.ts — Spinner-wrapped step execution.
 *
 * buildReporter bridges SyncReporter events to a clack spinner:
 *   onProgress → spinner message with live throughput
 *   onStatus(running) → spinner message update; final detail kept for stop line
 *   onLog → clack log lines
 *
 * runStep starts a spinner, runs the handler with the bridged reporter, and
 * stops the spinner with the final detail (or the failure message, code 1).
 * Returns false on failure so callers can aggregate an anyFailed exit code.
 */

import type { OutputAdapter } from "../../ui/output.js";
import type { PromptAdapter, SpinnerHandle } from "../../ui/prompt.js";
import type { SyncReporter, SyncStatusEvent, SyncLogEntry, SyncConfirm } from "../../features/transfer/reporter.js";
import type { RsyncProgress } from "../../services/rsync.js";

export interface StepSpec {
  key:     string;
  label:   string;
  dryRun:  boolean;
  run:     (reporter: SyncReporter, confirm: SyncConfirm) => Promise<void>;
}

/**
 * Terminal outcome of a step. Handlers may report "failed"/"skipped" via the
 * reporter WITHOUT throwing (fail-fast and confirm-decline paths) — callers
 * must not treat those as success: no history append, exit 1 on "failed".
 */
export type StepOutcome = "done" | "skipped" | "failed";

/**
 * Build a SyncReporter that forwards events to a clack spinner.
 * The spinner is not stopped here — the caller stops it after the handler
 * returns so the stop message can include the final result detail.
 */
export function buildReporter(
  label: string,
  spinner: SpinnerHandle,
  output: OutputAdapter,
): SyncReporter & { lastDetail: string; lastStatus: SyncStatusEvent["status"] | null } {
  let lastDetail = "";
  let lastStatus: SyncStatusEvent["status"] | null = null;

  return {
    get lastDetail() { return lastDetail; },
    get lastStatus() { return lastStatus; },

    onStatus(event: SyncStatusEvent): void {
      lastDetail = event.detail ?? event.error ?? "";
      lastStatus = event.status;
      if (event.status === "running" && event.detail) {
        spinner.message(`${label}  ${event.detail}`);
      }
    },

    onProgress(progress: RsyncProgress): void {
      spinner.message(`${label}  ${progress.percentage}%  ${progress.rate}`);
    },

    onLog(entry: SyncLogEntry): void {
      if (entry.level === "warn")  output.log.warn(entry.message);
      else if (entry.level === "error") output.log.error(entry.message);
      else output.log.step(entry.message);
    },
  };
}

export async function runStep(
  step: StepSpec,
  prompt: PromptAdapter,
  confirm: SyncConfirm,
  output: OutputAdapter,
): Promise<StepOutcome> {
  const stepLabel = step.dryRun ? `${step.label}  [dry-run]` : step.label;
  const spinner   = prompt.spinner();
  spinner.start(stepLabel);

  const reporter = buildReporter(stepLabel, spinner, output);

  try {
    await step.run(reporter, confirm);
    const detail = reporter.lastDetail;

    // Fail-fast handlers report "failed"/"skipped" without throwing — surface
    // that as the step outcome instead of pretending success.
    if (reporter.lastStatus === "failed") {
      spinner.stop(detail ? `${stepLabel}  ${detail}` : `${stepLabel}  failed`, 1);
      output.log.error(`${step.label} failed: ${detail || "unknown error"}`);
      return "failed";
    }
    if (reporter.lastStatus === "skipped") {
      spinner.stop(detail ? `${stepLabel}  ${detail}` : `${stepLabel}  skipped`);
      return "skipped";
    }

    spinner.stop(detail ? `${stepLabel}  ${detail}` : stepLabel);
    return "done";
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.stop(`${stepLabel}  failed: ${message}`, 1);
    output.log.error(`${step.label} failed: ${message}`);
    return "failed";
  }
}
