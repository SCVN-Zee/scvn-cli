/**
 * test/ui/prompt.test.ts — Cancel-as-throw contract for the real prompt adapter.
 *
 * Phase 1 replaced `process.exit(0)` on prompt cancellation with a thrown
 * `PromptCancelled`, so the same flows can run inside a long-lived host (the
 * Electron desktop app) without killing the process. The CLI entry maps the
 * throw to a clean exit 0. This test locks the throw contract by mocking
 * @clack/prompts to always return the cancellation sentinel.
 */

import { describe, it, expect, vi } from "vitest";

const CANCEL = Symbol("clack-cancel");

vi.mock("@clack/prompts", () => ({
  select: vi.fn(async () => CANCEL),
  multiselect: vi.fn(async () => CANCEL),
  confirm: vi.fn(async () => CANCEL),
  text: vi.fn(async () => CANCEL),
  spinner: vi.fn(() => ({ start() {}, message() {}, stop() {} })),
  isCancel: (value: unknown) => value === CANCEL,
}));

import { realPrompt } from "../../src/ui/prompt.js";
import { PromptCancelled } from "../../src/ui/errors.js";

describe("realPrompt — cancellation", () => {
  it("throws PromptCancelled from text() instead of exiting the process", async () => {
    await expect(realPrompt.text({ message: "path?" })).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("throws PromptCancelled from select()", async () => {
    await expect(
      realPrompt.select({ message: "pick", options: [{ value: "a", label: "A" }] }),
    ).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("throws PromptCancelled from multiselect()", async () => {
    await expect(
      realPrompt.multiselect({ message: "pick", options: [{ value: "a", label: "A" }] }),
    ).rejects.toBeInstanceOf(PromptCancelled);
  });

  it("throws PromptCancelled from confirm()", async () => {
    await expect(realPrompt.confirm({ message: "ok?" })).rejects.toBeInstanceOf(PromptCancelled);
  });
});
