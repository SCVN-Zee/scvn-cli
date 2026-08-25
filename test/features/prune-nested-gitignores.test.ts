/**
 * test/features/prune-nested-gitignores.test.ts — Unit tests for
 * pruneNestedGitignores. The git service is mocked and node:fs/promises rm +
 * realpath are spied; no real git or filesystem access.
 *
 * realpath is stubbed as identity so path comparison uses the raw strings:
 *   target "/repo/Assets"        → project root "/repo"       == repo "/repo"  → NORMAL scope
 *   target "/mono/GameA/Assets"  → project root "/mono/GameA" != repo "/mono"  → WIDE scope (ancestor guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot:          vi.fn<() => Promise<string | null>>(),
  listNestedGitignores: vi.fn<() => Promise<string[]>>(),
}));

const fspMocks = vi.hoisted(() => ({
  rm:       vi.fn().mockResolvedValue(undefined),
  realpath: vi.fn(async (p: string) => p),
}));

vi.mock("../../src/services/git.js", () => gitMocks);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: fspMocks.rm, realpath: fspMocks.realpath };
});

import { pruneNestedGitignores } from "../../src/features/setup/prune-nested-gitignores.js";

// ---------------------------------------------------------------------------
// Reporter capture helper
// ---------------------------------------------------------------------------

function makeReporter() {
  const events: SyncStatusEvent[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  return {
    reporter: {
      onStatus(e: SyncStatusEvent) { events.push(e); },
      onLog(e: { ts: number; level: string; message: string }) { logs.push(e); },
    },
    events,
    logs,
    lastStatus(): SyncStatusEvent | undefined { return events.at(-1); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.getRepoRoot.mockResolvedValue("/repo");
  gitMocks.listNestedGitignores.mockResolvedValue([]);
  fspMocks.rm.mockResolvedValue(undefined);
  fspMocks.realpath.mockImplementation(async (p: string) => p);
});

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

describe("pruneNestedGitignores — pre-flight", () => {
  it("skips (no deletes) when target is not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/not/a/repo/Assets", { reporter });

    expect(lastStatus()?.status).toBe("skipped");
    expect(gitMocks.listNestedGitignores).not.toHaveBeenCalled();
    expect(fspMocks.rm).not.toHaveBeenCalled();
  });

  it("reports done with no deletes when there are no nested .gitignore", async () => {
    gitMocks.listNestedGitignores.mockResolvedValue([]);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/repo/Assets", { reporter });

    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/no nested/i);
    expect(fspMocks.rm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Normal scope: repo root == Unity project root (project is its own repo)
// ---------------------------------------------------------------------------

describe("pruneNestedGitignores — project is its own repo", () => {
  it("removes each nested .gitignore under the repo root (not the Assets target)", async () => {
    gitMocks.listNestedGitignores.mockResolvedValue(["Assets/Foo/.gitignore", "Bar/.gitignore"]);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/repo/Assets", { reporter });

    expect(fspMocks.rm).toHaveBeenCalledWith("/repo/Assets/Foo/.gitignore", { force: true });
    expect(fspMocks.rm).toHaveBeenCalledWith("/repo/Bar/.gitignore", { force: true });
    expect(fspMocks.rm).toHaveBeenCalledTimes(2);
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/2 nested removed/);
  });

  it("dry-run reports would-remove and deletes nothing", async () => {
    gitMocks.listNestedGitignores.mockResolvedValue(["Assets/Foo/.gitignore"]);
    const { reporter, lastStatus, logs } = makeReporter();

    await pruneNestedGitignores("/repo/Assets", { reporter, dryRun: true });

    expect(fspMocks.rm).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/dry-run/i);
    expect(logs.some((l) => /would remove/.test(l.message))).toBe(true);
  });

  it("reports failed but keeps going when one rm rejects", async () => {
    gitMocks.listNestedGitignores.mockResolvedValue(["Assets/A/.gitignore", "Assets/B/.gitignore"]);
    fspMocks.rm
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValueOnce(undefined);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/repo/Assets", { reporter });

    expect(fspMocks.rm).toHaveBeenCalledTimes(2); // did NOT abort after the first failure
    expect(lastStatus()?.status).toBe("failed");
    expect(lastStatus()?.error).toMatch(/1 removed, 1 failed/);
  });
});

// ---------------------------------------------------------------------------
// Ancestor guard: repo root ABOVE the Unity project (nested / monorepo / $HOME)
// ---------------------------------------------------------------------------

describe("pruneNestedGitignores — ancestor guard (repo above project)", () => {
  beforeEach(() => {
    gitMocks.getRepoRoot.mockResolvedValue("/mono");
    gitMocks.listNestedGitignores.mockResolvedValue(["GameB/.gitignore"]);
  });

  it("refuses under -y (skipped, no deletes)", async () => {
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/mono/GameA/Assets", { reporter, autoYes: true });

    expect(lastStatus()?.status).toBe("skipped");
    expect(lastStatus()?.detail).toMatch(/above the project|under -y/i);
    expect(fspMocks.rm).not.toHaveBeenCalled();
  });

  it("prunes only after confirmWideScope approves", async () => {
    const confirmWideScope = vi.fn(async () => true);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/mono/GameA/Assets", { reporter, confirmWideScope });

    expect(confirmWideScope).toHaveBeenCalledWith({ repoRoot: "/mono", projectRoot: "/mono/GameA", count: 1 });
    expect(fspMocks.rm).toHaveBeenCalledWith("/mono/GameB/.gitignore", { force: true });
    expect(lastStatus()?.status).toBe("done");
  });

  it("skips when confirmWideScope declines", async () => {
    const confirmWideScope = vi.fn(async () => false);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/mono/GameA/Assets", { reporter, confirmWideScope });

    expect(fspMocks.rm).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("skipped");
  });

  it("refuses when no confirm seam is supplied (never silently prunes a wide scope)", async () => {
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/mono/GameA/Assets", { reporter });

    expect(fspMocks.rm).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("skipped");
  });

  it("dry-run previews the wide scope without prompting or deleting", async () => {
    const confirmWideScope = vi.fn(async () => true);
    const { reporter, lastStatus } = makeReporter();

    await pruneNestedGitignores("/mono/GameA/Assets", { reporter, dryRun: true, confirmWideScope });

    expect(confirmWideScope).not.toHaveBeenCalled();
    expect(fspMocks.rm).not.toHaveBeenCalled();
    expect(lastStatus()?.detail).toMatch(/dry-run/i);
    expect(lastStatus()?.detail).toMatch(/above project/i);
  });
});
