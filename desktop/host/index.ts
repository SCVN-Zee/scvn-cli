/**
 * desktop/host/index.ts — Utility-process entry for the command host.
 *
 * Runs inside Electron's `utilityProcess` (a clean Node context, isolated from
 * the window). Wires `process.parentPort` to the transport-agnostic dispatcher
 * so heavy git/rsync work can never block the UI thread. All command logic
 * lives in the registry; this file is only the parentPort ↔ dispatcher bridge.
 */

import type { MessagePortMain } from "electron";
import type { FromHost, ToHost } from "../shared/ipc.js";
import { createHost } from "./dispatcher.js";
import { registry } from "./registry.js";

// Electron augments the child process with `parentPort` (a MessagePortMain).
// @types/node has no such field, so read it through a narrow typed view.
const parentPort = (process as NodeJS.Process & { parentPort?: MessagePortMain }).parentPort;

if (!parentPort) {
  throw new Error("scvn host: process.parentPort unavailable — this entry must run as an Electron utilityProcess");
}

const port = parentPort;
const send = (message: FromHost): void => port.postMessage(message);
const host = createHost(send, registry);

port.on("message", (event: Electron.MessageEvent) => {
  host.handle(event.data as ToHost);
});

// MessagePortMain must be started before it dispatches queued messages.
port.start();
