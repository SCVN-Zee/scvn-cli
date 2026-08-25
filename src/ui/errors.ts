/**
 * ui/errors.ts — Typed control-flow errors for command flows.
 *
 * These replace hard `process.exit()` calls in reusable code paths so the same
 * flows can run inside a long-lived host (the Electron desktop app) without
 * killing the process. The CLI entry (`cli.tsx`) catches them and maps each to
 * the exit behavior it had before; the GUI host catches them and shows dialogs.
 *
 * - `PromptCancelled` — the user cancelled a prompt (Ctrl-C / Esc). CLI: exit 0.
 * - `ProjectsRootError` — the configured Unity projects root is missing/invalid
 *   and no interactive recovery is possible. CLI: stderr + exit 1.
 * - `ConfigRequiredError` — a root-needing command ran without a usable config
 *   in a non-interactive context. CLI: stderr + exit 1.
 */

/** User cancelled a prompt. Thrown by `guardCancel` in `ui/prompt.ts`. */
export class PromptCancelled extends Error {
  constructor(message = "Prompt cancelled") {
    super(message);
    this.name = "PromptCancelled";
  }
}

/** The Unity projects root is missing or points at a non-existent directory. */
export class ProjectsRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectsRootError";
  }
}

/** A root-needing command was invoked without a usable config (non-interactive). */
export class ConfigRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigRequiredError";
  }
}
