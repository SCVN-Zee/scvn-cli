/**
 * doctor/runner.ts — Parallel check executor for `scvn doctor`.
 *
 * run() iterates CHECKS via Promise.allSettled (parallel) and aggregates results.
 * Exit code:
 *   0 — all checks pass, warn, or skipped
 *   1 — any check returned severity 'fail'
 */

import { CHECKS } from "./checks.js";
import type { Check, CheckContext, CheckResult, Severity } from "./checks.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckReport {
  id: string;
  label: string;
  macOnly?: boolean;
  severity: Severity;
  detail?: string;
}

export interface RunnerResult {
  reports: CheckReport[];
  /** 0 = healthy (pass/warn/skip); 1 = any fail present */
  exitCode: 0 | 1;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run all checks in parallel. Safe to call from both CLI and tests.
 * Accepts an optional overrides list for unit-testing with mocked checks.
 */
export async function run(checks: Check[] = CHECKS, ctx: CheckContext = {}): Promise<RunnerResult> {
  const settled = await Promise.allSettled(
    checks.map((check) => check.run(ctx)),
  );

  const reports: CheckReport[] = settled.map((outcome, index) => {
    const check = checks[index]!;
    let result: CheckResult;

    if (outcome.status === "fulfilled") {
      result = outcome.value;
    } else {
      // Unexpected rejection — treat as fail so CI catches it
      result = {
        severity: "fail",
        detail: `Unexpected error: ${String(outcome.reason)}`,
      };
    }

    return {
      id: check.id,
      label: check.label,
      macOnly: check.macOnly,
      severity: result.severity,
      detail: result.detail,
    };
  });

  const hasFailure = reports.some((report) => report.severity === "fail");

  return {
    reports,
    exitCode: hasFailure ? 1 : 0,
  };
}
