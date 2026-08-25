/**
 * desktop/host/registry.ts — Maps command keys to host handlers.
 *
 * Registers `ping` (a dependency-free round-trip used by the headless
 * self-test) plus the scvn capability handlers from `capabilities.ts`, then
 * drops every command owned by a tab this build did not enable (SCVN_TABS), so
 * a hidden tab's commands are genuinely not invokable (the dispatcher returns
 * UnknownCommand for them).
 */

import type { CommandRegistry } from "./dispatcher.js";
import type { HostSession } from "./session.js";
import { capabilities } from "./capabilities.js";
import { ENABLED_TAB_IDS } from "../shared/commands.js";
import { selectRegistry } from "../shared/tab-commands.js";

/**
 * Stub round-trip handler. Streams a couple of progress + output events, then
 * returns a structured result echoing its argument.
 */
async function ping(session: HostSession, args: unknown): Promise<unknown> {
  session.emitOutput({ level: "intro", message: "scvn ping" });
  session.emitProgress({ phase: "start", message: "pinging…" });
  session.emitOutput({ level: "step", message: "host received invoke" });
  session.emitProgress({ phase: "message", message: "working…" });
  session.emitOutput({ level: "success", message: "pong" });
  session.emitProgress({ phase: "stop", message: "done" });
  session.emitOutput({ level: "outro", message: "ping: done" });
  return { pong: true, echo: args ?? null, at: new Date().toISOString() };
}

export const registry: CommandRegistry = selectRegistry({ ping, ...capabilities }, ENABLED_TAB_IDS);
