/**
 * desktop/host/gui-prompt.ts — PromptAdapter backed by the IPC prompt channel.
 *
 * Implements the Phase 1 `PromptAdapter` port: each method posts a
 * `prompt-request` and awaits the correlated answer. A `null` answer means the
 * user cancelled, which we surface as `PromptCancelled` — exactly the throw the
 * command flows and the dispatcher's top-level catch already expect, so the
 * host process survives a cancel. `text` with `kind:"dir"|"path"` is answered by
 * a native picker in the main process (transparent to this adapter). The spinner
 * seam maps to `progress-event`s.
 */

import type { PromptAdapter, PromptOption, SpinnerHandle } from "../../src/ui/prompt.js";
import { PromptCancelled } from "../../src/ui/errors.js";
import type { IpcPromptOption, PromptSpec, PromptValue } from "../shared/ipc.js";
import type { HostSession } from "./session.js";

function toIpcOptions(options: PromptOption<string>[]): IpcPromptOption[] {
  return options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }));
}

/** Post a prompt and unwrap the answer, throwing PromptCancelled on cancel. */
async function ask(session: HostSession, spec: PromptSpec): Promise<PromptValue> {
  const value = await session.requestPrompt(spec);
  if (value === null) throw new PromptCancelled();
  return value;
}

/**
 * Build a PromptAdapter over an invocation's session. The concrete methods
 * return `string` / `string[]` / `boolean`; the object is cast to the generic
 * `PromptAdapter` (as `realPrompt` does) because the generic string subtype `T`
 * cannot be reflected at runtime — the runtime contract matches exactly.
 */
export function createGuiPrompt(session: HostSession): PromptAdapter {
  const adapter = {
    async select({
      message,
      options,
      initialValue,
    }: {
      message: string;
      options: PromptOption<string>[];
      initialValue?: string;
    }): Promise<string> {
      const value = await ask(session, {
        type: "select",
        message,
        options: toIpcOptions(options),
        initialValue,
      });
      if (typeof value !== "string") throw new Error("gui prompt: select expected a string answer");
      return value;
    },

    async multiselect({
      message,
      options,
      initialValues,
      required,
    }: {
      message: string;
      options: PromptOption<string>[];
      initialValues?: string[];
      required?: boolean;
    }): Promise<string[]> {
      const value = await ask(session, {
        type: "multiselect",
        message,
        options: toIpcOptions(options),
        initialValues,
        required,
      });
      if (!Array.isArray(value)) throw new Error("gui prompt: multiselect expected an array answer");
      return value;
    },

    async confirm({ message, initialValue }: { message: string; initialValue?: boolean }): Promise<boolean> {
      const value = await ask(session, { type: "confirm", message, initialValue });
      if (typeof value !== "boolean") throw new Error("gui prompt: confirm expected a boolean answer");
      return value;
    },

    async text({
      message,
      placeholder,
      defaultValue,
      validate,
      kind,
    }: {
      message: string;
      placeholder?: string;
      defaultValue?: string;
      validate?: (value: string) => string | undefined;
      kind?: "path" | "dir";
    }): Promise<string> {
      // Mirror clack's behavior: re-prompt while the validator rejects the input.
      for (;;) {
        const value = await ask(session, { type: "text", message, placeholder, defaultValue, kind });
        if (typeof value !== "string") throw new Error("gui prompt: text expected a string answer");
        const problem = validate?.(value);
        if (problem) {
          session.emitOutput({ level: "error", message: problem });
          continue;
        }
        return value;
      }
    },

    spinner(): SpinnerHandle {
      return {
        start(message?: string): void {
          session.emitProgress({ phase: "start", message });
        },
        message(text?: string): void {
          session.emitProgress({ phase: "message", message: text });
        },
        stop(message?: string): void {
          session.emitProgress({ phase: "stop", message });
        },
      };
    },
  };

  return adapter as PromptAdapter;
}
