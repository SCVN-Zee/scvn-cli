/**
 * desktop/host/dispatcher.ts — Routes IPC messages to command handlers.
 *
 * `createHost` owns the map of in-flight sessions and turns the flat message
 * stream (`invoke` / `prompt-response` / `cancel`) into handler calls. It is
 * transport-agnostic: `send` is injected, so the whole dispatch layer is
 * unit-testable in plain Node without Electron's parentPort.
 */

import type { FromHost, ToHost } from "../shared/ipc.js";
import { HostSession } from "./session.js";

/** A command handler runs one capability against a session. */
export type CommandHandler = (session: HostSession, args: unknown) => Promise<unknown>;

/** Registry of command key -> handler. */
export type CommandRegistry = Record<string, CommandHandler>;

export interface HostApi {
  /** Feed one inbound message. Never throws — errors surface as ErrorMessages. */
  handle(message: ToHost): void;
}

/** Serialize an unknown throw into an ErrorMessage's name/message fields. */
function describeError(err: unknown): { name: string; message: string; stage?: string } {
  if (err instanceof Error) {
    const candidate = err as Error & { stage?: unknown };
    const stage = typeof candidate.stage === "string" ? candidate.stage : undefined;
    return { name: err.name || "Error", message: err.message, ...(stage ? { stage } : {}) };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Build a host dispatcher over an injected `send` and a command registry.
 * Each `invoke` creates a HostSession, runs the handler, and reports a
 * `result` or `error`. `prompt-response` and `cancel` route to the session.
 */
export function createHost(send: (message: FromHost) => void, registry: CommandRegistry): HostApi {
  const sessions = new Map<string, HostSession>();

  return {
    handle(message: ToHost): void {
      switch (message.kind) {
        case "invoke": {
          const { requestId, command, args } = message;
          const session = new HostSession(requestId, send);
          sessions.set(requestId, session);

          const handler = registry[command];
          if (!handler) {
            send({ kind: "error", requestId, name: "UnknownCommand", message: `Unknown command: ${command}` });
            sessions.delete(requestId);
            return;
          }

          void handler(session, args)
            .then((value) => {
              send({ kind: "result", requestId, value });
            })
            .catch((err: unknown) => {
              const { name, message: msg, stage } = describeError(err);
              send({ kind: "error", requestId, name, message: msg, ...(stage ? { stage } : {}) });
            })
            .finally(() => {
              sessions.delete(requestId);
            });
          return;
        }

        case "prompt-response": {
          sessions.get(message.requestId)?.resolvePrompt(message.promptId, message.value);
          return;
        }

        case "cancel": {
          sessions.get(message.requestId)?.cancel();
          return;
        }
      }
    },
  };
}
