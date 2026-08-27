/**
 * lib/bridge.ts — Thin wrappers over the preload-exposed `window.scvn` bridge.
 *
 * `window.scvn` is a global singleton injected by the preload script (and, in
 * browser verification, by a test stub). These helpers keep components free of
 * raw event plumbing: `invokeForResult` runs a request/response command
 * (`<id>:prepare`, `templates:read|write|reset`) and resolves its result value
 * using a private listener, so it never disturbs an active run's event routing.
 * Streaming runs subscribe to `window.scvn.onEvent` directly (RunOpView) so the
 * listener is registered before the invoke, avoiding a first-event race.
 */

import type { FromHost, RequestId, PromptValue } from "@shared/ipc";

export function bridge() {
  return window.scvn;
}

/** Invoke a request/response command and resolve with its result value. */
export function invokeForResult(command: string, args?: unknown): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const requestId = args === undefined ? window.scvn.invoke(command) : window.scvn.invoke(command, args);
  const off = window.scvn.onEvent((message: FromHost) => {
    if (message.requestId !== requestId) return;
    if (message.kind === "result") {
      off();
      resolve(message.value);
    } else if (message.kind === "error") {
      off();
      reject(new Error(message.message));
    }
  });
  return promise;
}

export function respondPrompt(requestId: RequestId, promptId: string, value: PromptValue | null): void {
  window.scvn.respondPrompt(requestId, promptId, value);
}

export function cancelRun(requestId: RequestId): void {
  window.scvn.cancel(requestId);
}

export function pickDirectory(
  options?: { kind?: "dir" | "path"; title?: string; defaultPath?: string },
): Promise<string | null> {
  return window.scvn.pickDirectory(options);
}

export function pickDirectories(
  options?: { kind?: "dir" | "path"; title?: string; defaultPath?: string },
): Promise<string[] | null> {
  return window.scvn.pickDirectories(options);
}

export function pickSaveFile(
  options?: { title?: string; defaultPath?: string },
): Promise<string | null> {
  return window.scvn.pickSaveFile(options);
}
