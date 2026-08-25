/**
 * test/features/toggle-submodule-ignore.test.ts — Unit tests for the generalized
 * two-way submodule ignore=dirty toggle.
 *
 * The git service is fully mocked; the multi-select seam is supplied as a fake
 * `confirm` that returns the desired final-state Set (of submodule PATHS).
 * autoYes bypasses confirm.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot:      vi.fn<() => Promise<string | null>>(),
  listSubmodules:   vi.fn<() => Promise<Array<{ name: string; path: string }>>>(),
  getLocalConfig:   vi.fn<() => Promise<string | null>>(),
  setLocalConfig:   vi.fn().mockResolvedValue(undefined),
  unsetLocalConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/services/git.js", () => gitMocks);

import { toggleSubmoduleIgnore } from "../../src/features/setup/toggle-submodule-ignore.js";
import type {
  SubmoduleConfirm,
  SubmoduleIgnoreItem,
} from "../../src/features/setup/toggle-submodule-ignore.js";

// ---------------------------------------------------------------------------
// Reporter capture helper
// ---------------------------------------------------------------------------

function makeReporter() {
  const events: SyncStatusEvent[] = [];
  return {
    reporter: {
      onStatus(e: SyncStatusEvent) { events.push(e); },
      onLog() { /* ignored */ },
    },
    events,
    lastStatus(): SyncStatusEvent | undefined { return events.at(-1); },
  };
}

/** Build {name, path} entries where name == path (the common case). */
function samePath(...paths: string[]): Array<{ name: string; path: string }> {
  return paths.map((p) => ({ name: p, path: p }));
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.setLocalConfig.mockResolvedValue(undefined);
  gitMocks.unsetLocalConfig.mockResolvedValue(undefined);
  gitMocks.getLocalConfig.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toggleSubmoduleIgnore", () => {
  it("emits status:failed when not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/not/a/repo/Assets", { autoYes: true, reporter });

    expect(lastStatus()?.status).toBe("failed");
    expect(lastStatus()?.error).toMatch(/not a git repo/i);
  });

  it("emits status:skipped (exit 0) when the repo has no submodules", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue([]);
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { autoYes: true, reporter });

    expect(lastStatus()?.status).toBe("skipped");
    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
  });

  it("-y sets ignore=dirty on every submodule (none currently set)", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockResolvedValue(null);
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { autoYes: true, reporter });

    expect(gitMocks.setLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/A.ignore", "dirty");
    expect(gitMocks.setLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/B.ignore", "dirty");
    expect(gitMocks.setLocalConfig).toHaveBeenCalledTimes(2);
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
  });

  it("-y is idempotent when all submodules already ignore=dirty", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockResolvedValue("dirty");
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { autoYes: true, reporter });

    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/0 applied/);
  });

  it("interactive: preselection reflects current ignore=dirty state", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockImplementation(async (_repo, key) =>
      key.includes("Assets/A") ? "dirty" : null,
    );
    let captured: SubmoduleIgnoreItem[] = [];
    const confirm: SubmoduleConfirm = async (_title, items) => {
      captured = items;
      return new Set(items.filter((i) => i.preselected).map((i) => i.label));
    };
    const { reporter } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { reporter, confirm });

    expect(captured).toEqual([
      { label: "Assets/A", preselected: true },
      { label: "Assets/B", preselected: false },
    ]);
  });

  it("interactive: sets selected-and-unset, unsets deselected-and-set", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockImplementation(async (_repo, key) =>
      key.includes("Assets/A") ? "dirty" : null, // A dirty, B not
    );
    // desired = {B}: A deselected (was dirty → unset), B selected (was not → set)
    const confirm: SubmoduleConfirm = async () => new Set(["Assets/B"]);
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { reporter, confirm });

    expect(gitMocks.unsetLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/A.ignore");
    expect(gitMocks.setLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/B.ignore", "dirty");
    expect(lastStatus()?.status).toBe("done");
  });

  it("interactive: empty submitted set unsets ALL currently-ignored submodules", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockResolvedValue("dirty"); // both dirty
    // Deselect-all + submit (NOT cancel — cancel exits at the adapter).
    const confirm: SubmoduleConfirm = async () => new Set<string>();
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { reporter, confirm });

    expect(gitMocks.unsetLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/A.ignore");
    expect(gitMocks.unsetLocalConfig).toHaveBeenCalledWith("/repo", "submodule.Assets/B.ignore");
    expect(gitMocks.unsetLocalConfig).toHaveBeenCalledTimes(2);
    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
  });

  it("keys the ignore flag on the submodule NAME while displaying the PATH (custom --name)", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    // name != path — e.g. `git submodule add --name luna-sub <url> Assets/Supercent/Luna`
    gitMocks.listSubmodules.mockResolvedValue([
      { name: "luna-sub", path: "Assets/Supercent/Luna" },
    ]);
    gitMocks.getLocalConfig.mockResolvedValue(null);
    let captured: SubmoduleIgnoreItem[] = [];
    const confirm: SubmoduleConfirm = async (_title, items) => {
      captured = items;
      return new Set(items.map((i) => i.label)); // select all (by path)
    };
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { reporter, confirm });

    // Picker shows the PATH...
    expect(captured).toEqual([{ label: "Assets/Supercent/Luna", preselected: false }]);
    // ...but the state probe and the write both key on the NAME.
    expect(gitMocks.getLocalConfig).toHaveBeenCalledWith("/repo", "submodule.luna-sub.ignore");
    expect(gitMocks.setLocalConfig).toHaveBeenCalledWith("/repo", "submodule.luna-sub.ignore", "dirty");
    expect(gitMocks.setLocalConfig).toHaveBeenCalledTimes(1);
    expect(lastStatus()?.status).toBe("done");
  });

  it("dry-run reports intended changes but writes nothing", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A", "Assets/B"));
    gitMocks.getLocalConfig.mockResolvedValue(null);
    const { reporter, lastStatus } = makeReporter();

    await toggleSubmoduleIgnore("/repo/Assets", { autoYes: true, dryRun: true, reporter });

    expect(gitMocks.setLocalConfig).not.toHaveBeenCalled();
    expect(gitMocks.unsetLocalConfig).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/dry-run/i);
  });

  it("throws when interactive mode is missing the confirm seam", async () => {
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    gitMocks.listSubmodules.mockResolvedValue(samePath("Assets/A"));
    const { reporter } = makeReporter();

    await expect(
      toggleSubmoduleIgnore("/repo/Assets", { reporter }),
    ).rejects.toThrow(/confirm is required/i);
  });
});
