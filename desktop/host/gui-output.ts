/**
 * desktop/host/gui-output.ts — OutputAdapter backed by the IPC event stream.
 *
 * Implements the Phase 1 `OutputAdapter` port so the existing command flows
 * emit their chrome + log lines as `output-event`s that the renderer's results
 * pane renders. No business logic — just a transport for the same calls the CLI
 * would send to `ui/clack.ts`.
 */

import type { OutputAdapter } from "../../src/ui/output.js";
import type { HostSession } from "./session.js";

/** Build an OutputAdapter that streams every line to the session's UI. */
export function createGuiOutput(session: HostSession): OutputAdapter {
  return {
    intro(title: string): void {
      session.emitOutput({ level: "intro", message: title });
    },
    outro(message: string): void {
      session.emitOutput({ level: "outro", message });
    },
    log: {
      info(message: string): void {
        session.emitOutput({ level: "info", message });
      },
      success(message: string): void {
        session.emitOutput({ level: "success", message });
      },
      warn(message: string): void {
        session.emitOutput({ level: "warn", message });
      },
      error(message: string): void {
        session.emitOutput({ level: "error", message });
      },
      step(message: string): void {
        session.emitOutput({ level: "step", message });
      },
    },
  };
}
