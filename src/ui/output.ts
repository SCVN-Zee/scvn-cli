/**
 * ui/output.ts — Output adapter interface for linear command flows.
 *
 * Mirrors the `PromptAdapter` pattern (interface + `real*` + `fake*`): command
 * flows emit chrome (`intro`/`outro`) and structured log lines through an
 * injected adapter instead of importing `ui/clack.ts` statically. That lets the
 * same flows render into a TTY (CLI) or stream over IPC into the desktop GUI
 * without forking business logic.
 *
 * `realOutput` delegates to `ui/clack.ts` (which keeps the picocolors theme in
 * one place). `fakeOutput` records calls for unit tests, paralleling `fakePrompt`.
 */

import { intro as clackIntro, outro as clackOutro, log as clackLog } from "./clack.js";

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/** Structured log surface — one method per severity/step level. */
export interface OutputLog {
  /** Neutral informational line. */
  info(message: string): void;
  /** Green success line — check passed. */
  success(message: string): void;
  /** Yellow warning line — passed with caveats. */
  warn(message: string): void;
  /** Red error line — failed. */
  error(message: string): void;
  /** Dimmed step annotation (subordinate detail lines). */
  step(message: string): void;
}

/** Output surface injected into command flows in place of static clack imports. */
export interface OutputAdapter {
  /** Print the connector-bar intro header. */
  intro(title: string): void;
  /** Print the connector-bar outro footer. */
  outro(message: string): void;
  /** Structured log lines. */
  log: OutputLog;
}

// ---------------------------------------------------------------------------
// Real implementation — backed by ui/clack.ts (TTY + picocolors theme)
// ---------------------------------------------------------------------------

export const realOutput: OutputAdapter = {
  intro: clackIntro,
  outro: clackOutro,
  log: clackLog,
};

// ---------------------------------------------------------------------------
// Fake implementation — for unit tests (no TTY required)
// ---------------------------------------------------------------------------

/** A recorded call from `fakeOutput`. The `type` discriminant narrows by kind. */
export type FakeOutputCall =
  | { type: "intro"; message: string }
  | { type: "outro"; message: string }
  | { type: "info"; message: string }
  | { type: "success"; message: string }
  | { type: "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "step"; message: string };

/**
 * Create a fake output adapter for tests. `calls` accumulates every emitted
 * line for assertion.
 */
export function fakeOutput(): OutputAdapter & { calls: FakeOutputCall[] } {
  const calls: FakeOutputCall[] = [];
  return {
    calls,
    intro(message: string) {
      calls.push({ type: "intro", message });
    },
    outro(message: string) {
      calls.push({ type: "outro", message });
    },
    log: {
      info(message: string) {
        calls.push({ type: "info", message });
      },
      success(message: string) {
        calls.push({ type: "success", message });
      },
      warn(message: string) {
        calls.push({ type: "warn", message });
      },
      error(message: string) {
        calls.push({ type: "error", message });
      },
      step(message: string) {
        calls.push({ type: "step", message });
      },
    },
  };
}
