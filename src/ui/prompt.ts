/**
 * ui/prompt.ts — Prompt adapter interface for linear command flows.
 *
 * Wraps @clack/prompts (select / multiselect / confirm / text) behind a thin
 * interface so individual command flows are testable without a TTY: tests swap
 * in the `fake` implementation which captures calls and returns scripted answers.
 *
 * Only the four prompt types actually used by the linear command flows are included (YAGNI).
 * The spinner handle is bundled here so flows import one object for all I/O.
 */

import {
  select as clackSelect,
  multiselect as clackMultiselect,
  confirm as clackConfirm,
  text as clackText,
  spinner as clackSpinner,
  isCancel,
} from "@clack/prompts";
import { PromptCancelled } from "./errors.js";

// ---------------------------------------------------------------------------
// Option type shared by select / multiselect
// ---------------------------------------------------------------------------

export interface PromptOption<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Spinner handle (subset of @clack/prompts spinner)
// ---------------------------------------------------------------------------

export interface SpinnerHandle {
  start(message?: string): void;
  /** Update the spinner label while it is running (live throughput text). */
  message(text?: string): void;
  stop(message?: string, code?: number): void;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface PromptAdapter {
  /** Single-select from a list of options. Exits process on cancel (Ctrl-C). */
  select<T extends string>(opts: {
    message: string;
    options: PromptOption<T>[];
    initialValue?: T;
  }): Promise<T>;

  /** Multi-select from a list of options. Exits process on cancel. */
  multiselect<T extends string>(opts: {
    message: string;
    options: PromptOption<T>[];
    initialValues?: T[];
    required?: boolean;
  }): Promise<T[]>;

  /** Yes / No confirmation. Exits process on cancel. */
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean>;

  /**
   * Free-text input. Throws PromptCancelled on cancel.
   * `kind` marks the semantic type of the value so a GUI adapter can open a
   * native picker (dir/file) instead of a text field; the TTY adapter ignores it.
   */
  text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
    kind?: "path" | "dir";
  }): Promise<string>;

  /** Returns a spinner handle backed by whatever the adapter uses for output. */
  spinner(): SpinnerHandle;
}

// ---------------------------------------------------------------------------
// Real implementation — backed by @clack/prompts + TTY
// ---------------------------------------------------------------------------

/**
 * Convert a cancelled prompt into a typed throw.
 * Clack returns a symbol for cancellation; we surface it as `PromptCancelled`
 * so callers (CLI entry / GUI host) decide how to react instead of the process
 * dying here. The CLI maps it to a clean exit 0, preserving today's UX.
 */
function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    throw new PromptCancelled();
  }
  return value as T;
}

// The clack library's generic Option<T> and Validate<T> signatures don't align
// with our PromptAdapter interface in all strict-mode scenarios (clack returns
// T | symbol before cancel-guard; clack's validate receives string | undefined).
// We cast the entire object to PromptAdapter so TypeScript accepts the
// structurally correct but generically incompatible implementations without
// `any` escapes scattered across every method.  The runtime contract matches
// the interface exactly — guardCancel throws PromptCancelled on cancel.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const realPrompt = {
  async select({ message, options, initialValue }: {
    message: string;
    options: PromptOption<string>[];
    initialValue?: string;
  }): Promise<string> {
    const result = await clackSelect({ message, options: options as any, initialValue });
    return guardCancel(result) as string;
  },

  async multiselect({ message, options, initialValues, required }: {
    message: string;
    options: PromptOption<string>[];
    initialValues?: string[];
    required?: boolean;
  }): Promise<string[]> {
    const result = await clackMultiselect({
      message,
      options: options as any,
      initialValues,
      required: required ?? true,
    });
    return guardCancel(result) as string[];
  },

  async confirm({ message, initialValue }: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean> {
    const result = await clackConfirm({ message, initialValue });
    return guardCancel(result) as boolean;
  },

  async text({ message, placeholder, defaultValue, validate }: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
    kind?: "path" | "dir";
  }): Promise<string> {
    // clack's validate callback receives string | undefined; callers always
    // pass a string, so casting keeps the interface clean. `kind` is a GUI-only
    // hint (native picker) and is intentionally ignored by the TTY adapter.
    const result = await clackText({ message, placeholder, defaultValue, validate: validate as any });
    return guardCancel(result) as string;
  },

  spinner(): SpinnerHandle {
    return clackSpinner();
  },
} as PromptAdapter;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Fake implementation — for unit tests (no TTY required)
// ---------------------------------------------------------------------------

/**
 * A recorded call from `fakePrompt`.
 * The `type` discriminant lets test assertions narrow by prompt kind.
 * select/multiselect calls also record their options and initial value(s)
 * so tests can assert option filtering and visible-default preselection.
 */
export type FakeCall =
  | { type: "select"; message: string; options?: Array<{ value: string; label: string }>; initialValue?: string }
  | { type: "multiselect"; message: string; options?: Array<{ value: string; label: string }>; initialValues?: string[] }
  | { type: "confirm"; message: string }
  | { type: "text"; message: string; kind?: "path" | "dir" }
  | { type: "spinner.start";   message: string | undefined }
  | { type: "spinner.message"; message: string | undefined }
  | { type: "spinner.stop";    message: string | undefined };

/** Scripted answer for one prompt invocation (in FIFO order). */
export type FakeAnswer = string | string[] | boolean;

/**
 * Create a fake prompt adapter for tests.
 *
 * Pass `answers` in order of expected prompt calls. Each resolved value is
 * shifted off the queue and returned. If the queue is empty a descriptive
 * error is thrown so missing stubbing is obvious.
 *
 * `calls` accumulates every prompt/spinner event for assertion.
 */
export function fakePrompt(answers: FakeAnswer[] = []): PromptAdapter & {
  calls: FakeCall[];
} {
  const queue = [...answers];
  const calls: FakeCall[] = [];

  function nextAnswer(type: string): FakeAnswer {
    if (queue.length === 0) {
      throw new Error(`fakePrompt: no scripted answer for "${type}" prompt`);
    }
    return queue.shift()!;
  }

  // Cast to the intersection type: the fake returns scripted values at runtime;
  // generics can't be reflected at runtime, so the structural cast is correct.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return {
    calls,

    async select({ message, options, initialValue }: { message: string; options: any[]; initialValue?: any }) {
      calls.push({ type: "select", message, options, initialValue });
      return nextAnswer("select") as any;
    },

    async multiselect({ message, options, initialValues }: { message: string; options: any[]; initialValues?: any[]; required?: boolean }) {
      calls.push({ type: "multiselect", message, options, initialValues });
      return nextAnswer("multiselect") as any;
    },

    async confirm({ message }: { message: string; initialValue?: boolean }) {
      calls.push({ type: "confirm", message });
      return nextAnswer("confirm") as any;
    },

    async text({ message, kind }: { message: string; placeholder?: string; defaultValue?: string; validate?: (value: string) => string | undefined; kind?: "path" | "dir" }) {
      calls.push({ type: "text", message, kind });
      return nextAnswer("text") as string;
    },

    spinner(): SpinnerHandle {
      return {
        start(message?: string) {
          calls.push({ type: "spinner.start", message });
        },
        message(text?: string) {
          calls.push({ type: "spinner.message", message: text });
        },
        stop(message?: string) {
          calls.push({ type: "spinner.stop", message });
        },
      };
    },
  } as PromptAdapter & { calls: FakeCall[] };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
