/**
 * commands/doctor.ts — Linear clack flow for `scvn doctor`.
 *
 * Replaces the Ink doctor screen. Runs the same check suite via the existing
 * doctor/runner, then prints each result as a structured log line (success /
 * warn / error) matching the severity semantics of the original screen.
 *
 * Exit-code parity with the old Ink screen:
 *   0 — all checks passed, warned, or were skipped (non-failure outcomes)
 *   1 — one or more checks returned severity "fail"
 *
 * Does NOT call Ink render(); safe to invoke from a plain async context.
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { run } from "../doctor/runner.js";
import type { CheckReport, RunnerResult } from "../doctor/runner.js";
import type { Check, CheckContext } from "../doctor/checks.js";
import { CHECKS } from "../doctor/checks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format one check report as a human-readable string.
 * Label comes first; optional detail follows after an em-dash separator.
 */
function formatLine(report: CheckReport): string {
  const base = report.label;
  if (report.severity === "skipped") {
    // Skipped checks carry their reason in detail (macOnly checks: "macOS only — skipped";
    // bundled-node on a dev checkout: "no bundled node …"). Fall back to the macOS phrasing.
    return `${base}  (${report.detail ?? "macOS only — skipped"})`;
  }
  return report.detail ? `${base}  ${report.detail}` : base;
}

/**
 * Emit the appropriate clack log call for a single report's severity.
 */
function logReport(report: CheckReport, output: OutputAdapter): void {
  const line = formatLine(report);
  switch (report.severity) {
    case "pass":    output.log.success(line); break;
    case "warn":    output.log.warn(line);    break;
    case "fail":    output.log.error(line);   break;
    case "skipped": output.log.step(line);    break;
  }
}

// ---------------------------------------------------------------------------
// Public flow
// ---------------------------------------------------------------------------

/**
 * Run doctor checks and print results as linear clack output.
 *
 * Accepts an optional `checks` override so unit tests can inject fake checks
 * without touching the real environment.
 */
export async function runDoctor(
  checks: Check[] = CHECKS,
  ctx: CheckContext = {},
  output: OutputAdapter = realOutput,
): Promise<void> {
  output.intro("scvn doctor");

  let result: RunnerResult;

  try {
    result = await run(checks, ctx);
  } catch (err) {
    // Unexpected runner-level error (not a per-check error — those are caught
    // inside run() and reported as severity "fail").
    output.log.error(`Doctor runner failed unexpectedly: ${String(err)}`);
    process.exitCode = 1;
    output.outro("doctor: aborted");
    return;
  }

  // Print each check result in registration order
  for (const report of result.reports) {
    logReport(report, output);
  }

  // Summary counts
  const pass    = result.reports.filter((r) => r.severity === "pass").length;
  const warn    = result.reports.filter((r) => r.severity === "warn").length;
  const fail    = result.reports.filter((r) => r.severity === "fail").length;
  const skipped = result.reports.filter((r) => r.severity === "skipped").length;

  const parts: string[] = [`pass ${pass}`];
  if (warn    > 0) parts.push(`warn ${warn}`);
  if (fail    > 0) parts.push(`fail ${fail}`);
  if (skipped > 0) parts.push(`skipped ${skipped}`);
  const summaryLine = parts.join("  ");

  // Set exit code before outro so any at-exit handlers see the right value.
  // Mirrors the Ink screen: non-zero iff any check returned "fail".
  process.exitCode = result.exitCode;

  output.outro(
    result.exitCode === 0
      ? `All checks passed  ${summaryLine}`
      : `Some checks failed  ${summaryLine}`,
  );
}
