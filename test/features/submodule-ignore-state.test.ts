/**
 * test/features/submodule-ignore-state.test.ts — Unit tests for the desktop
 * Ignore-dirty page's read/set engine.
 *
 * The git service is fully mocked. readSubmoduleIgnoreState joins the submodule
 * list with per-name local `ignore=dirty` state and the `.gitmodules` fallback;
 * setSubmoduleIgnore writes/clears ONLY the local override, keyed on name.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot: vi.fn<() => Promise<string | null>>(),
  listSubmodules: vi.fn<() => Promise<Array<{ name: string; path: string }>>>(),
  getLocalConfig: vi.fn<() => Promise<string | null>>(),
  setLocalConfig: vi.fn().mockResolvedValue(undefined),
  unsetLocalConfig: vi.fn().mockResolvedValue(undefined),
  listSubmoduleGitmodulesIgnore: vi.fn<() => Promise<Record<string, string>>>(),
}));

vi.mock("../../src/services/git.js", () => gitMocks);

import {
  readSubmoduleIgnoreState,
  setSubmoduleIgnore,
} from "../../src/features/setup/submodule-ignore-state.js";

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.getRepoRoot.mockResolvedValue("/repo");
  gitMocks.listSubmodules.mockResolvedValue([]);
  gitMocks.getLocalConfig.mockResolvedValue(null);
  gitMocks.listSubmoduleGitmodulesIgnore.mockResolvedValue({});
});

describe("readSubmoduleIgnoreState", () => {
  it("returns notRepo when the target is not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    expect(await readSubmoduleIgnoreState("/nope")).toEqual({ status: "notRepo", target: "/nope" });
  });

  it("returns noSubmodules for a repo with no .gitmodules entries", async () => {
    gitMocks.listSubmodules.mockResolvedValue([]);
    expect(await readSubmoduleIgnoreState("/repo")).toEqual({ status: "noSubmodules", repo: "/repo" });
  });

  it("reports localDirty from the local override, keyed on submodule NAME", async () => {
    gitMocks.listSubmodules.mockResolvedValue([
      { name: "libA", path: "Assets/A" },
      { name: "libB", path: "Assets/B" },
    ]);
    // Local override set for libA only — resolved by NAME, not path.
    gitMocks.getLocalConfig.mockImplementation(async (_repo: string, key: string) =>
      key === "submodule.libA.ignore" ? "dirty" : null,
    );

    const state = await readSubmoduleIgnoreState("/repo");
    expect(state).toEqual({
      status: "ok",
      repo: "/repo",
      submodules: [
        { name: "libA", path: "Assets/A", localDirty: true, gitmodulesIgnore: null },
        { name: "libB", path: "Assets/B", localDirty: false, gitmodulesIgnore: null },
      ],
    });
  });

  it("surfaces the .gitmodules ignore value even when there is no local override", async () => {
    gitMocks.listSubmodules.mockResolvedValue([{ name: "vendored", path: "Third/vendored" }]);
    gitMocks.getLocalConfig.mockResolvedValue(null);
    gitMocks.listSubmoduleGitmodulesIgnore.mockResolvedValue({ vendored: "dirty" });

    const state = await readSubmoduleIgnoreState("/repo");
    // Toggle reflects the LOCAL override (off), but the gitmodules fallback is exposed.
    expect(state).toEqual({
      status: "ok",
      repo: "/repo",
      submodules: [{ name: "vendored", path: "Third/vendored", localDirty: false, gitmodulesIgnore: "dirty" }],
    });
  });
});

describe("setSubmoduleIgnore", () => {
  it("sets the local key to dirty when toggled on, keyed on NAME", async () => {
    const result = await setSubmoduleIgnore("/repo", "libA", true);
    expect(gitMocks.setLocalConfig).toHaveBeenCalledWith("/repo", "submodule.libA.ignore", "dirty");
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", name: "libA", localDirty: true });
  });

  it("unsets the local key when toggled off", async () => {
    const result = await setSubmoduleIgnore("/repo", "libB", false);
    expect(gitMocks.unsetLocalConfig).toHaveBeenCalledWith("/repo", "submodule.libB.ignore");
    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "ok", name: "libB", localDirty: false });
  });

  it("returns notRepo and writes nothing when the target is not a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const result = await setSubmoduleIgnore("/nope", "libA", true);
    expect(result).toEqual({ status: "notRepo", target: "/nope" });
    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
  });
});
