/**
 * desktop/host/registry.ts — Maps command keys to host handlers.
 *
 * Registers `ping` (a dependency-free round-trip used by the headless
 * self-test) plus every scvn capability handler from `capabilities.ts`. The
 * host registers all commands regardless of `SCVN_TABS`: tab hiding is a
 * renderer-visibility concern only (see the ⌘⇧. reveal in the renderer), so a
 * revealed tab's commands are genuinely invokable.
 */

import type { CommandRegistry } from "./dispatcher.js";
import type { HostSession } from "./session.js";
import { capabilities } from "./capabilities.js";

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

export const registry: CommandRegistry = { ping, ...capabilities };
