/**
 * test/features/export-packages.test.ts — Unit tests for exportPackages.
 *
 * rsync + sizes + git are mocked; meta.json runs against REAL tmp fixtures so
 * nested relPaths (Plugins/Sirenix) and sidecars are exercised end-to-end.
 *
 * exportPackages takes the package already resolved by the caller
 * (resolveAddFolder) — see test/features/resolve-add-folder.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncStatusEvent, SyncReporter } from "../../src/features/transfer/reporter.js";

const rsyncMocks = vi.hoisted(() => ({
  rsyncCopyStream: vi.fn(),
  rsyncCopy:       vi.fn(),
}));

vi.mock("../../src/services/rsync.js", () => rsyncMocks);

vi.mock("../../src/util/du-size.js", () => ({
  duSize:      vi.fn(),
  formatBytes: vi.fn(),
}));

vi.mock("../../src/services/git.js", () => ({
  getRepoInfo: vi.fn(),
}));

import { exportPackages } from "../../src/features/packages/export-packages.js";
import { readPackagesStoreMeta } from "../../src/features/store/store-meta.js";
import { duSize, formatBytes } from "../../src/util/du-size.js";
import { getRepoInfo } from "../../src/services/git.js";

const mockDuSize      = vi.mocked(duSize);
const mockFormatBytes = vi.mocked(formatBytes);
const mockGetRepoInfo = vi.mocked(getRepoInfo);

function makeFakeReporter() {
  const statusEvents: SyncStatusEvent[] = [];
  const reporter: SyncReporter = {
    onStatus(event) { statusEvents.push(event); },
    onProgress()    { /* not asserted */ },
    onLog()         { /* not asserted */ },
  };
  return { reporter, statusEvents };
}

const VFOLDERS = { label: "vFolders",       relPath: "vFolders" };
const ODIN     = { label: "Odin Inspector", relPath: "Plugins/Sirenix" };

describe("exportPackages", () => {
  let src: string;
  let storeDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rsyncMocks.rsyncCopyStream.mockImplementation(async function* () { /* no progress events */ });
    rsyncMocks.rsyncCopy.mockResolvedValue(undefined);
    mockDuSize.mockResolvedValue(1024 * 1024);
    mockFormatBytes.mockImplementation((n: number) => `${n}B`);
    mockGetRepoInfo.mockResolvedValue({ root: "/fake/hub", branch: "main" });

    const root = join(tmpdir(), `scvn-export-pkgs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    src      = join(root, "hub", "Assets");
    storeDir = join(root, "store");
    // Fixtures: flat package, nested package with sidecar
    await mkdir(join(src, "vFolders"), { recursive: true });
    await mkdir(join(src, "Plugins", "Sirenix"), { recursive: true });
    await writeFile(join(src, "Plugins", "Sirenix.meta"), "guid: 123", "utf8");
    await mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(src, "..", ".."), { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("stages selected packages incl. nested relPath + sidecar, writes meta with per-package bytes", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await exportPackages(src, [VFOLDERS, ODIN], { reporter, storeDir });

    // Both packages mirrored into the store
    const streamCalls = rsyncMocks.rsyncCopyStream.mock.calls.map((c) => [c[0], c[1]]);
    expect(streamCalls).toEqual([
      [`${join(src, "vFolders")}/`,         `${join(storeDir, "packages", "vFolders")}/`],
      [`${join(src, "Plugins", "Sirenix")}/`, `${join(storeDir, "packages", "Plugins", "Sirenix")}/`],
    ]);

    // Sidecar copied for Sirenix only (vFolders has none)
    expect(rsyncMocks.rsyncCopy).toHaveBeenCalledTimes(1);
    expect(rsyncMocks.rsyncCopy).toHaveBeenCalledWith(
      join(src, "Plugins", "Sirenix.meta"),
      join(storeDir, "packages", "Plugins", "Sirenix.meta"),
      expect.anything(),
    );

    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.kind).toBe("packages");
    expect(meta?.packages).toEqual([
      { label: "vFolders",       relPath: "vFolders",        bytes: 1024 * 1024,
        sourcePath: src, sourceName: "hub", branch: "main", stagedAt: expect.any(String) },
      { label: "Odin Inspector", relPath: "Plugins/Sirenix", bytes: 1024 * 1024,
        sourcePath: src, sourceName: "hub", branch: "main", stagedAt: expect.any(String) },
    ]);

    expect(statusEvents.at(-1)?.status).toBe("done");
  });

  it("empty selection → skipped, no writes", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await exportPackages(src, [], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
    expect(rsyncMocks.rsyncCopyStream).not.toHaveBeenCalled();
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("decline confirm → skipped/Aborted, no rsync, no meta", async () => {
    const { reporter, statusEvents } = makeFakeReporter();
    const decline = vi.fn().mockResolvedValue(false);

    await exportPackages(src, [VFOLDERS], { reporter, storeDir, confirm: decline });

    expect(statusEvents[0]?.status).toBe("skipped");
    expect(statusEvents[0]?.detail).toBe("Aborted");
    expect(rsyncMocks.rsyncCopyStream).not.toHaveBeenCalled();
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("dry-run: rsync gets dryRun, meta NOT written", async () => {
    const { reporter } = makeFakeReporter();

    await exportPackages(src, [VFOLDERS], { reporter, storeDir, dryRun: true });

    expect(rsyncMocks.rsyncCopyStream).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ dryRun: true }),
    );
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("accumulates: a second add from another source keeps earlier packages", async () => {
    const { reporter } = makeFakeReporter();

    // First add: vFolders from hub
    await exportPackages(src, [VFOLDERS], { reporter, storeDir });

    // Second add: Odin from a different project on a different branch
    const otherSrc = join(src, "..", "..", "game", "Assets");
    await mkdir(join(otherSrc, "Plugins", "Sirenix"), { recursive: true });
    mockGetRepoInfo.mockResolvedValue({ root: "/fake/game", branch: "dev" });
    await exportPackages(otherSrc, [ODIN], { reporter, storeDir });

    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages.map((p) => p.label)).toEqual(["vFolders", "Odin Inspector"]);
    expect(meta?.packages[0]).toMatchObject({ sourceName: "hub", branch: "main" });
    expect(meta?.packages[1]).toMatchObject({ sourceName: "game", branch: "dev", sourcePath: otherSrc });
  });

  it("re-adding a label updates it in place (no duplicate)", async () => {
    const { reporter } = makeFakeReporter();

    await exportPackages(src, [VFOLDERS], { reporter, storeDir });
    mockDuSize.mockResolvedValue(4096);
    await exportPackages(src, [VFOLDERS], { reporter, storeDir });

    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages).toHaveLength(1);
    expect(meta?.packages[0]?.bytes).toBe(4096);
  });
});
