/**
 * test/commands/shared/select-target-projects.test.ts — Unit tests for the
 * import-side target picker's early-exit contract (single-target).
 *
 * These branches (`--to` handling, autoYes-without-to) return/throw BEFORE any
 * project discovery, so no discover/config mocks are needed. The `--to`
 * normalization walks the ProjectVersion.txt marker through the fs-predicates
 * isFile seam (mocked to a fixed root); the interactive single-select path is
 * covered end-to-end by the command flow tests.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakePrompt } from "../../../src/ui/prompt.js";
import { fakeOutput } from "../../../src/ui/output.js";
import { selectTargetProjects, UsageError } from "../../../src/commands/shared/select-target-projects.js";

const fsPredicateMocks = vi.hoisted(() => ({
  isFile: vi.fn(),
}));

vi.mock("../../../src/util/fs-predicates.js", () => ({
  exists: vi.fn(),
  isDir:  vi.fn(),
  isFile: fsPredicateMocks.isFile,
}));

const ROOT_A = "/projects/game-a";
const A = `${ROOT_A}/Assets`;
const B = "/projects/game-b/Assets";

describe("selectTargetProjects()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsPredicateMocks.isFile.mockImplementation(async (p: string) =>
      p === `${ROOT_A}/ProjectSettings/ProjectVersion.txt`);
  });

  it("--to with one project-root path returns it without prompting", async () => {
    const prompt = fakePrompt([]);
    const targets = await selectTargetProjects(prompt, fakeOutput(), { to: [ROOT_A] });
    expect(targets).toEqual([ROOT_A]);
    expect(prompt.calls).toHaveLength(0);
  });

  it("--to pointing at an Assets dir resolves to the project root", async () => {
    const prompt = fakePrompt([]);
    const targets = await selectTargetProjects(prompt, fakeOutput(), { to: [A] });
    expect(targets).toEqual([ROOT_A]);
    expect(prompt.calls).toHaveLength(0);
  });

  it("--to outside any Unity project throws UsageError", async () => {
    const prompt = fakePrompt([]);
    await expect(
      selectTargetProjects(prompt, fakeOutput(), { to: ["/tmp/loose"] }),
    ).rejects.toBeInstanceOf(UsageError);
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
