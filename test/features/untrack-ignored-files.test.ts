/**
 * test/features/untrack-ignored-files.test.ts — Unit tests for
 * untrackIgnoredFiles. The git service is mocked and node:fs/promises realpath
 * is stubbed as identity; no real git or filesystem access.
 *
 * realpath identity means path comparison uses the raw strings:
 *   target "/repo/Assets"        → project root "/repo"       == repo "/repo"  → NORMAL scope
 *   target "/mono/GameA/Assets"  → project root "/mono/GameA" != repo "/mono"  → WIDE scope (ancestor guard)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot:             vi.fn<() => Promise<string | null>>(),
  listTrackedIgnoredFiles: vi.fn<() => Promise<string[]>>(),
  gitRmCached:             vi.fn<() => Promise<void>>(),
}));

const fspMocks = vi.hoisted(() => ({
  realpath: vi.fn(async (p: string) => p),
}));

vi.mock("../../src/services/git.js", () => gitMocks);
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: fspMocks.realpath };
});

import { untrackIgnoredFiles } from "../../src/features/setup/untrack-ignored-files.js";

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
  gitMocks.listTrackedIgnoredFiles.mockResolvedValue([]);
  gitMocks.gitRmCached.mockResolvedValue(undefined);
  fspMocks.realpath.mockImplementation(async (p: string) => p);
});

describe("untrackIgnoredFiles — pre-flight", () => {
  it("skips (no rm) when target is not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/not/a/repo/Assets", { reporter });

    expect(lastStatus()?.status).toBe("skipped");
    expect(gitMocks.listTrackedIgnoredFiles).not.toHaveBeenCalled();
    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
  });

  it("reports done ('nothing to untrack') when no tracked file is now ignored", async () => {
    gitMocks.listTrackedIgnoredFiles.mockResolvedValue([]);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/repo/Assets", { reporter });

    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/nothing to untrack/i);
    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
  });
});

describe("untrackIgnoredFiles — project is its own repo (normal scope)", () => {
  it("rm --cached the tracked-but-ignored files, NUL-safe names included", async () => {
    gitMocks.listTrackedIgnoredFiles.mockResolvedValue(["Assets/debug.log", "Assets/a b.tmp"]);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/repo/Assets", { reporter });

    expect(gitMocks.gitRmCached).toHaveBeenCalledWith("/repo", ["Assets/debug.log", "Assets/a b.tmp"]);
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/untracked 2 file\(s\)/);
  });

  it("dry-run previews the would-untrack list and removes nothing", async () => {
    gitMocks.listTrackedIgnoredFiles.mockResolvedValue(["Assets/debug.log"]);
    const { reporter, lastStatus, logs } = makeReporter();

    await untrackIgnoredFiles("/repo/Assets", { reporter, dryRun: true });

    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("done");
    expect(lastStatus()?.detail).toMatch(/dry-run/i);
    expect(logs.some((l) => /would untrack/.test(l.message))).toBe(true);
  });
});

describe("untrackIgnoredFiles — ancestor guard (repo above project)", () => {
  beforeEach(() => {
    gitMocks.getRepoRoot.mockResolvedValue("/mono");
    gitMocks.listTrackedIgnoredFiles.mockResolvedValue(["GameB/debug.log"]);
  });

  it("refuses under -y (skipped, no rm)", async () => {
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/mono/GameA/Assets", { reporter, autoYes: true });

    expect(lastStatus()?.status).toBe("skipped");
    expect(lastStatus()?.detail).toMatch(/above the project|under -y/i);
    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
  });

  it("untracks only after confirmWideScope approves", async () => {
    const confirmWideScope = vi.fn(async () => true);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/mono/GameA/Assets", { reporter, confirmWideScope });

    expect(confirmWideScope).toHaveBeenCalledWith({ repoRoot: "/mono", projectRoot: "/mono/GameA", count: 1 });
    expect(gitMocks.gitRmCached).toHaveBeenCalledWith("/mono", ["GameB/debug.log"]);
    expect(lastStatus()?.status).toBe("done");
  });

  it("skips when confirmWideScope declines", async () => {
    const confirmWideScope = vi.fn(async () => false);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/mono/GameA/Assets", { reporter, confirmWideScope });

    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("skipped");
  });

  it("refuses when no confirm seam is supplied (never silently untracks a wide scope)", async () => {
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/mono/GameA/Assets", { reporter });

    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("skipped");
  });

  it("dry-run previews the wide scope without prompting or removing", async () => {
    const confirmWideScope = vi.fn(async () => true);
    const { reporter, lastStatus } = makeReporter();

    await untrackIgnoredFiles("/mono/GameA/Assets", { reporter, dryRun: true, confirmWideScope });

    expect(confirmWideScope).not.toHaveBeenCalled();
    expect(gitMocks.gitRmCached).not.toHaveBeenCalled();
    expect(lastStatus()?.detail).toMatch(/dry-run/i);
    expect(lastStatus()?.detail).toMatch(/above project/i);
  });
});
