/**
 * desktop/preload.ts — contextBridge API exposed to the sandboxed renderer.
 *
 * Runs with `contextIsolation: true` / `sandbox: true`, so the renderer sees
 * only the small `window.scvn` surface defined here — no Node globals, no
 * ipcRenderer. Every renderer→host message is generated with a fresh
 * `requestId`; every host→renderer event is delivered through `onEvent`.
 */

import { contextBridge, ipcRenderer } from "electron";
import type { FromHost, PromptValue, RequestId, ScvnBridge, ToHost, UpdateStatus } from "./shared/ipc.js";

const CHANNEL_TO_HOST = "scvn:to-host";
const CHANNEL_FROM_HOST = "scvn:from-host";
const CHANNEL_SELFTEST = "scvn:selftest";
const CHANNEL_PICK_DIR = "scvn:pick-dir";
const CHANNEL_UPDATE_STATUS = "scvn:update-status";
const CHANNEL_UPDATE_CHECK = "scvn:update-check";
const CHANNEL_UPDATE_DOWNLOAD = "scvn:update-download";
const CHANNEL_UPDATE_INSTALL = "scvn:update-install";

const bridge: ScvnBridge & { __selftest(ok: boolean): void } = {
  invoke(command: string, args?: unknown): RequestId {
    // Web Crypto global — available in a sandboxed preload (node:crypto is not).
    const requestId = crypto.randomUUID();
    const message: ToHost = { kind: "invoke", requestId, command, args };
    ipcRenderer.send(CHANNEL_TO_HOST, message);
    return requestId;
  },

  onEvent(handler: (message: FromHost) => void): () => void {
    const listener = (_event: unknown, message: FromHost): void => handler(message);
    ipcRenderer.on(CHANNEL_FROM_HOST, listener);
    return () => ipcRenderer.removeListener(CHANNEL_FROM_HOST, listener);
  },

  respondPrompt(requestId: RequestId, promptId: string, value: PromptValue | null): void {
    const message: ToHost = { kind: "prompt-response", requestId, promptId, value };
    ipcRenderer.send(CHANNEL_TO_HOST, message);
  },

  cancel(requestId: RequestId): void {
    const message: ToHost = { kind: "cancel", requestId };
    ipcRenderer.send(CHANNEL_TO_HOST, message);
  },

  pickDirectory(options?: { kind?: "dir" | "path"; title?: string; defaultPath?: string }): Promise<string | null> {
    return ipcRenderer.invoke(CHANNEL_PICK_DIR, options ?? {}) as Promise<string | null>;
  },

  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void {
    const listener = (_event: unknown, status: UpdateStatus): void => handler(status);
    ipcRenderer.on(CHANNEL_UPDATE_STATUS, listener);
    return () => ipcRenderer.removeListener(CHANNEL_UPDATE_STATUS, listener);
  },

  checkForUpdates(): void {
    ipcRenderer.send(CHANNEL_UPDATE_CHECK);
  },

  downloadUpdate(): void {
    ipcRenderer.send(CHANNEL_UPDATE_DOWNLOAD);
  },

  quitAndInstall(): void {
    ipcRenderer.send(CHANNEL_UPDATE_INSTALL);
  },

  /** Test-only: report the headless self-test outcome so main can exit. */
  __selftest(ok: boolean): void {
    ipcRenderer.send(CHANNEL_SELFTEST, ok);
  },
};

contextBridge.exposeInMainWorld("scvn", bridge);
