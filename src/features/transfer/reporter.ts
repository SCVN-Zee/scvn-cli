/**
 * features/transfer/reporter.ts — Callback seam for sync handler output.
 *
 * Decouples handler logic from both Zustand and clack. Each handler accepts
 * a SyncReporter instead of calling store.updateStep / store.appendLog directly,
 * making the handlers unit-testable and reusable from any UI (clack, tests, etc.).
 *
 * Callers map the reporter callbacks to whatever output layer they use:
 *   - clack flow: onStatus/onProgress → spinner.message; onLog → clack.log
 *   - tests: capture calls, assert payloads
 */

import type { RsyncProgress } from "../../services/rsync.js";

// ---------------------------------------------------------------------------
// Status / log types (mirror sync-slice without the Zustand dependency)
// ---------------------------------------------------------------------------

export type SyncStepStatus = "running" | "done" | "failed" | "skipped";

export interface SyncStatusEvent {
  status: SyncStepStatus;
  /** Human-readable detail line (for done / failed / skipped) */
  detail?: string;
  /** Error message for failed status */
  error?: string;
}

export interface SyncLogEntry {
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

// ---------------------------------------------------------------------------
// Reporter interface
// ---------------------------------------------------------------------------

export interface SyncReporter {
  /** Called whenever handler status changes (running → done, etc.) */
  onStatus(event: SyncStatusEvent): void;
  /** Called with rsync throughput data during file transfer */
  onProgress(progress: RsyncProgress): void;
  /** Called for informational/warning log lines */
  onLog(entry: SyncLogEntry): void;
}

// ---------------------------------------------------------------------------
// No-op reporter — safe default for headless callers that ignore output
// ---------------------------------------------------------------------------

export const noopReporter: SyncReporter = {
  onStatus:   () => undefined,
  onProgress: () => undefined,
  onLog:      () => undefined,
};

// ---------------------------------------------------------------------------
// Confirm seam — INPUT from UI to handler (separate from reporter output)
//
// Each destructive handler receives a SyncConfirm so the caller controls
// whether to pop a real TTY prompt or short-circuit (autoYes, tests).
//
// Handlers call `await confirm({ title, body })` before any write.
// If it returns false the handler emits status:"skipped", detail:"Aborted."
// and returns without touching the filesystem.
// ---------------------------------------------------------------------------

export type SyncConfirm = (opts: { title: string; body?: string }) => Promise<boolean>;

/**
 * autoConfirm — always returns true.
 * Used when autoYes=true or in headless/test contexts that want unconditional runs.
 */
export const autoConfirm: SyncConfirm = async () => true;
