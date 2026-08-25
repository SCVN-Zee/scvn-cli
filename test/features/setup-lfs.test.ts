/**
 * test/features/setup-lfs.test.ts — Unit tests for setupLfs.
 *
 * Mocks the git service + LFS writer so the reporter/status contract and the
 * git-lfs preflight are asserted without a real repo or the git-lfs binary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot:        vi.fn(),
  detectGitLfs:       vi.fn(),
  gitLfsInstallLocal: vi.fn().mockResolvedValue(undefined),
}));
const writerMocks = vi.hoisted(() => ({
  writeLfsAttributes: vi.fn(),
}));

vi.mock("../../src/services/git.js", () => gitMocks);
vi.mock("../../src/writers/write-lfs-attributes.js", () => writerMocks);

import { setupLfs } from "../../src/features/setup/setup-lfs.js";

function fakeReporter() {
  const events: SyncStatusEvent[] = [];
  return {
    events,
    onStatus: (e: SyncStatusEvent) => events.push(e),
    onLog: () => {},
    last() { return events.at(-1); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.getRepoRoot.mockResolvedValue("/repo");
  gitMocks.detectGitLfs.mockResolvedValue(true);
  gitMocks.gitLfsInstallLocal.mockResolvedValue(undefined);
  writerMocks.writeLfsAttributes.mockResolvedValue({
    path: "/repo/.gitattributes", backupPath: "", written: true,
  });
});

describe("setupLfs", () => {
  it("skips cleanly when the target is not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const r = fakeReporter();

    await setupLfs("/x/Assets", { reporter: r });

    expect(r.last()).toEqual({ status: "skipped", detail: "no git repo" });
    expect(gitMocks.gitLfsInstallLocal).not.toHaveBeenCalled();
    expect(writerMocks.writeLfsAttributes).not.toHaveBeenCalled();
  });

  it("throws the brew hint when git-lfs is not installed", async () => {
    gitMocks.detectGitLfs.mockResolvedValue(false);

    await expect(setupLfs("/x/Assets", {})).rejects.toThrow(/git-lfs not installed/);
    expect(gitMocks.gitLfsInstallLocal).not.toHaveBeenCalled();
    expect(writerMocks.writeLfsAttributes).not.toHaveBeenCalled();
  });

  it("installs LFS + writes the repo-root .gitattributes on the happy path", async () => {
    const r = fakeReporter();

    await setupLfs("/x/Assets", { reporter: r });

    expect(gitMocks.gitLfsInstallLocal).toHaveBeenCalledWith("/repo");
    expect(writerMocks.writeLfsAttributes).toHaveBeenCalledWith({
      gitattributesPath: "/repo/.gitattributes",
    });
    expect(r.last()?.status).toBe("done");
  });

  it("dry-run writes nothing", async () => {
    const r = fakeReporter();

    await setupLfs("/x/Assets", { dryRun: true, reporter: r });

    expect(gitMocks.gitLfsInstallLocal).not.toHaveBeenCalled();
    expect(writerMocks.writeLfsAttributes).not.toHaveBeenCalled();
    expect(r.last()?.status).toBe("done");
    expect(r.last()?.detail).toMatch(/would/);
  });

  it("dry-run previews (never throws/fails) even when git-lfs is missing, noting it", async () => {
    gitMocks.detectGitLfs.mockResolvedValue(false);
    const r = fakeReporter();

    await expect(setupLfs("/x/Assets", { dryRun: true, reporter: r })).resolves.toBeUndefined();

    expect(gitMocks.gitLfsInstallLocal).not.toHaveBeenCalled();
    expect(writerMocks.writeLfsAttributes).not.toHaveBeenCalled();
    expect(r.last()?.status).toBe("done"); // preview, not a failure
    expect(r.last()?.detail).toMatch(/git-lfs not installed/);
  });
});
