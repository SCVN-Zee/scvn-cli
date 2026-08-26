/**
 * test/features/setup-merge-attributes.test.ts — Unit tests for
 * setupMergeAttributes.
 *
 * Mocks the git service + gitattributes writer so the skip/apply contract is
 * asserted without a real repo. The writer itself (marker-block insert,
 * idempotency, backup) is covered by test/writers/write-gitattributes.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot: vi.fn(),
}));
const writerMocks = vi.hoisted(() => ({
  writeGitAttributes: vi.fn(),
}));

vi.mock("../../src/services/git.js", () => gitMocks);
vi.mock("../../src/writers/write-gitattributes.js", () => writerMocks);

import { setupMergeAttributes } from "../../src/features/setup/setup-merge-attributes.js";

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.getRepoRoot.mockResolvedValue("/repo");
  writerMocks.writeGitAttributes.mockResolvedValue({
    perProject: [{ path: "/repo/.gitattributes", backupPath: "", written: true }],
  });
});

describe("setupMergeAttributes", () => {
  it("skips cleanly when the target is not inside a git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const r = await setupMergeAttributes("/not/a/repo/Assets");
    expect(r.status).toBe("skipped");
    expect(writerMocks.writeGitAttributes).not.toHaveBeenCalled();
  });

  it("writes the merge block at the resolved repo root", async () => {
    const r = await setupMergeAttributes("/repo/Assets");
    expect(gitMocks.getRepoRoot).toHaveBeenCalledWith("/repo/Assets");
    expect(writerMocks.writeGitAttributes).toHaveBeenCalledWith({ projectPaths: ["/repo"] });
    expect(r.status).toBe("done");
    expect(r.detail).toMatch(/synced/);
  });

  it("reports up-to-date when the block was already present", async () => {
    writerMocks.writeGitAttributes.mockResolvedValue({
      perProject: [{ path: "/repo/.gitattributes", backupPath: "", written: false }],
    });
    const r = await setupMergeAttributes("/repo/Assets");
    expect(r.status).toBe("done");
    expect(r.detail).toMatch(/up to date/);
  });

  it("dry-run previews the intent without writing", async () => {
    const r = await setupMergeAttributes("/repo/Assets", { dryRun: true });
    expect(writerMocks.writeGitAttributes).not.toHaveBeenCalled();
    expect(r.status).toBe("done");
    expect(r.detail).toMatch(/would/);
  });
});
