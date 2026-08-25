/**
 * desktop/host/session.ts — Per-invocation state in the command host.
 *
 * One `HostSession` exists for the lifetime of a single `invoke`. It is the
 * seam the GUI adapters (Phase 3 `guiPrompt` / `guiOutput`) build on:
 *   - `emitOutput` / `emitProgress` push chrome + spinner events to the UI.
 *   - `requestPrompt` posts a prompt-request and returns a promise that the
 *     dispatcher resolves when the matching `prompt-response` arrives.
 *   - `cancel` resolves every outstanding prompt with `null` so the adapter
 *     can surface a `PromptCancelled` and the flow unwinds cleanly.
 *
 * Nothing here imports Electron — the dispatcher is unit-testable in Node.
 */

import type {
  FromHost,
  OutputEvent,
  ProgressEvent,
  PromptSpec,
  PromptValue,
  RequestId,
} from "../shared/ipc.js";

interface PendingPrompt {
  resolve(value: PromptValue | null): void;
}

export class HostSession {
  /** True once a cancel message arrived for this invocation. */
  cancelled = false;

  private readonly pending = new Map<string, PendingPrompt>();
  private promptSeq = 0;

  constructor(
    readonly requestId: RequestId,
    private readonly send: (message: FromHost) => void,
  ) {}

  /** Push a chrome / log line to the UI. */
  emitOutput(event: OutputEvent): void {
    this.send({ kind: "output-event", requestId: this.requestId, event });
  }

  /** Push a spinner lifecycle event to the UI. */
  emitProgress(event: ProgressEvent): void {
    this.send({ kind: "progress-event", requestId: this.requestId, event });
  }

  /**
   * Ask the UI (or a native dialog, decided by main) to answer a prompt.
   * Resolves with the user's value, or `null` if cancelled.
   */
  requestPrompt(prompt: PromptSpec): Promise<PromptValue | null> {
    const promptId = `${this.requestId}:${this.promptSeq++}`;
    return new Promise<PromptValue | null>((resolve) => {
      this.pending.set(promptId, { resolve });
      this.send({ kind: "prompt-request", requestId: this.requestId, promptId, prompt });
    });
  }

  /** Route an incoming prompt-response to its waiting promise. */
  resolvePrompt(promptId: string, value: PromptValue | null): void {
    const entry = this.pending.get(promptId);
    if (!entry) return;
    this.pending.delete(promptId);
    entry.resolve(value);
  }

  /** Cancel the invocation: unblock every pending prompt with `null`. */
  cancel(): void {
    this.cancelled = true;
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
  }
}
