/**
 * test/features/setup-templates.test.ts — Unit tests for setupTemplate / setupTemplates.
 *
 * setupTemplate(tgt, key, opts) now takes a reporter seam instead of writing to
 * the Zustand store. Tests assert reporter calls and the status emitted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const gitMocks = vi.hoisted(() => ({
  getRepoRoot: vi.fn<() => Promise<string | null>>(),
}));

const fileCompareMock = vi.hoisted(() => ({
  compareFiles: vi.fn().mockResolvedValue({ size: 100, isNew: false, isUpToDate: false }),
}));

const templateMock = vi.hoisted(() => ({
  resolveTemplateKey: vi.fn<() => Promise<string>>(),
  templateFilename: vi.fn<(k: string) => string>().mockImplementation((k) => `.${k}`),
  _resetTemplatesDir: vi.fn(),
}));

const rsyncMock = vi.hoisted(() => ({
  rsyncCopy: vi.fn().mockResolvedValue(undefined),
}));

const fspMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/services/git.js", () => gitMocks);
vi.mock("../../src/util/file-compare.js", () => fileCompareMock);
vi.mock("../../src/util/template-paths.js", () => templateMock);
vi.mock("../../src/services/rsync.js", () => rsyncMock);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: fspMocks.mkdir };
});

import { setupTemplate, setupTemplates } from "../../src/features/setup/setup-templates.js";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

// ---------------------------------------------------------------------------
// Reporter capture helper
// ---------------------------------------------------------------------------

function makeReporter() {
  const events: SyncStatusEvent[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  return {
    reporter: {
      onStatus(event: SyncStatusEvent) { events.push(event); },
      onLog(entry: { ts: number; level: string; message: string }) { logs.push(entry); },
    },
    events,
    logs,
    lastStatus(): SyncStatusEvent | undefined { return events.at(-1); },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  gitMocks.getRepoRoot.mockResolvedValue("/repo");
  templateMock.resolveTemplateKey.mockResolvedValue("/templates/.gitignore");
  templateMock.templateFilename.mockImplementation((k) => `.${k}`);
  fileCompareMock.compareFiles.mockResolvedValue({ size: 100, isNew: false, isUpToDate: false });
  rsyncMock.rsyncCopy.mockResolvedValue(undefined);
  fspMocks.mkdir.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupTemplate (single key)", () => {
  it("emits status:done after rsync", async () => {
    const { reporter, lastStatus } = makeReporter();
    await setupTemplate("/repo/Assets", "gitignore", { reporter });

    expect(lastStatus()?.status).toBe("done");
    expect(rsyncMock.rsyncCopy).toHaveBeenCalledOnce();
  });

  it("writes .gitignore to the git repo root, not the nested Unity project root", async () => {
    // Unity project nested in a larger repo: dirname(target) ≠ repo root.
    gitMocks.getRepoRoot.mockResolvedValue("/repo");
    const { reporter } = makeReporter();

    await setupTemplate("/repo/UnityProj/Assets", "gitignore", { reporter });

    expect(rsyncMock.rsyncCopy).toHaveBeenCalledWith(
      "/templates/.gitignore",
      "/repo/.gitignore",
      expect.anything(),
    );
  });

  it("falls back to the Unity project root for .gitignore when there is no git repo", async () => {
    gitMocks.getRepoRoot.mockResolvedValue(null);
    const { reporter } = makeReporter();

    await setupTemplate("/proj/Assets", "gitignore", { reporter });

    expect(rsyncMock.rsyncCopy).toHaveBeenCalledWith(
      "/templates/.gitignore",
      "/proj/.gitignore",
      expect.anything(),
    );
  });

  it("emits status:skipped when files are up-to-date", async () => {
    fileCompareMock.compareFiles.mockResolvedValue({ size: 100, isNew: false, isUpToDate: true });
    const { reporter, lastStatus } = makeReporter();

    await setupTemplate("/repo/Assets", "gitignore", { reporter });

    expect(rsyncMock.rsyncCopy).not.toHaveBeenCalled();
    expect(lastStatus()?.status).toBe("skipped");
    expect(lastStatus()?.detail).toMatch(/up to date/i);
  });

  it("emits status:failed and rethrows on rsync error", async () => {
    rsyncMock.rsyncCopy.mockRejectedValue(new Error("rsync boom"));
    const { reporter, lastStatus } = makeReporter();

    await expect(setupTemplate("/repo/Assets", "gitignore", { reporter })).rejects.toThrow("rsync boom");
    expect(lastStatus()?.status).toBe("failed");
  });

  it("dryRun=true: skips mkdir, still calls rsyncCopy with dryRun", async () => {
    const { reporter } = makeReporter();
    await setupTemplate("/repo/Assets", "gitignore", { reporter, dryRun: true });

    expect(fspMocks.mkdir).not.toHaveBeenCalled();
    expect(rsyncMock.rsyncCopy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ dryRun: true })
    );
  });
});

describe("setupTemplates (batch)", () => {
  it("processes the default key and emits done", async () => {
    templateMock.resolveTemplateKey.mockResolvedValueOnce("/t/.gitignore");

    const allEvents: SyncStatusEvent[] = [];
    const batchReporter = {
      onStatus(e: SyncStatusEvent) { allEvents.push(e); },
      onLog() {},
    };

    await setupTemplates("/repo/Assets", undefined, { reporter: batchReporter });

    const doneEvents = allEvents.filter((e) => e.status === "done");
    expect(doneEvents).toHaveLength(1);
  });

  it("processes only keys passed", async () => {
    const allEvents: SyncStatusEvent[] = [];
    const batchReporter = {
      onStatus(e: SyncStatusEvent) { allEvents.push(e); },
      onLog() {},
    };

    await setupTemplates("/repo/Assets", ["gitignore"], { reporter: batchReporter });

    const doneEvents = allEvents.filter((e) => e.status === "done");
    expect(doneEvents).toHaveLength(1);
    expect(rsyncMock.rsyncCopy).toHaveBeenCalledOnce();
  });

  it("non-fatal: a key failure is swallowed (no throw)", async () => {
    rsyncMock.rsyncCopy.mockRejectedValueOnce(new Error("first boom"));

    const allEvents: SyncStatusEvent[] = [];
    const batchReporter = {
      onStatus(e: SyncStatusEvent) { allEvents.push(e); },
      onLog() {},
    };

    await setupTemplates("/repo/Assets", ["gitignore"], {
      reporter: batchReporter,
    });

    const failed = allEvents.filter((e) => e.status === "failed");
    const done   = allEvents.filter((e) => e.status === "done");
    expect(failed).toHaveLength(1);
    expect(done).toHaveLength(0);
  });
});
