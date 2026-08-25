/**
 * test/commands/shared/select-target-projects.test.ts — Unit tests for the
 * import-side target picker's early-exit contract (single-target).
 *
 * These branches (`--to` handling, autoYes-without-to) return/throw BEFORE any
 * project discovery, so no discover/config mocks are needed. The interactive
 * single-select path is covered end-to-end by the command flow tests.
 */

import { describe, it, expect } from "vitest";
import { fakePrompt } from "../../../src/ui/prompt.js";
import { fakeOutput } from "../../../src/ui/output.js";
import { selectTargetProjects, UsageError } from "../../../src/commands/shared/select-target-projects.js";

const A = "/projects/game-a/Assets";
const B = "/projects/game-b/Assets";

describe("selectTargetProjects()", () => {
  it("--to with one path returns it without prompting", async () => {
    const prompt = fakePrompt([]);
    const targets = await selectTargetProjects(prompt, fakeOutput(), { to: [A] });
    expect(targets).toEqual([A]);
    expect(prompt.calls).toHaveLength(0);
  });

  it("--to with 2+ paths throws UsageError (imports are single-target)", async () => {
    const prompt = fakePrompt([]);
    await expect(
      selectTargetProjects(prompt, fakeOutput(), { to: [A, B] }),
    ).rejects.toBeInstanceOf(UsageError);
    expect(prompt.calls).toHaveLength(0);
  });

  it("autoYes without --to throws UsageError (never auto-picks an overwrite target)", async () => {
    const prompt = fakePrompt([]);
    await expect(
      selectTargetProjects(prompt, fakeOutput(), { autoYes: true }),
    ).rejects.toBeInstanceOf(UsageError);
    expect(prompt.calls).toHaveLength(0);
  });
});
