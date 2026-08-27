/**
 * test/features/import-packages.test.ts — Unit tests for importPackages.
 *
 * rsync is mocked; store/target fixtures and the dangling-.meta cleanup run
 * against REAL tmp dirs so the rm path is exercised for real.
 *
 * The target is the project ROOT and staged relPaths are project-root-relative:
 * Assets/... packages land under <target>/Assets/, Packages/... under
 * <target>/Packages/.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncStatusEvent, SyncReporter } from "../../src/features/transfer/reporter.js";
import type { StagedPackage } from "../../src/features/store/store-meta.js";

const rsyncMocks = vi.hoisted(() => ({
  rsyncCopyStream: vi.fn(),
  rsyncCopy:       vi.fn(),
}));

vi.mock("../../src/services/rsync.js", () => rsyncMocks);

import { importPackages } from "../../src/features/packages/import-packages.js";

const STAGED: StagedPackage[] = [
  { label: "vFolders",       relPath: "Assets/vFolders",        bytes: 1 },
  { label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 1 },
];

function makeFakeReporter() {
  const statusEvents: SyncStatusEvent[] = [];
  const reporter: SyncReporter = {
    onStatus: (event) => { statusEvents.push(event); },
    onLog:    () => {},
  };
  return { reporter, statusEvents };
}

describe("importPackages", () => {
  let root: string;
  let storeDir: string;
  let target: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    rsyncMocks.rsyncCopyStream.mockImplementation(async function* () { /* no events */ });
    rsyncMocks.rsyncCopy.mockResolvedValue(undefined);

    root     = join(tmpdir(), `scvn-import-pkgs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storeDir = join(root, "store");
    target   = join(root, "game"); // the target project ROOT
    // Staged slot mirrors both packages at their root-relative identity
    await mkdir(join(storeDir, "packages", "Assets", "vFolders"), { recursive: true });
    await mkdir(join(storeDir, "packages", "Assets", "Plugins", "Sirenix"), { recursive: true });
    await mkdir(join(target, "Assets"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("applies every staged package store → target at its root-relative location", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir });

    const streamCalls = rsyncMocks.rsyncCopyStream.mock.calls.map((c) => [c[0], c[1]]);
    expect(streamCalls).toEqual([
      [`${join(storeDir, "packages", "Assets", "vFolders")}/`,          `${join(target, "Assets", "vFolders")}/`],
      [`${join(storeDir, "packages", "Assets", "Plugins", "Sirenix")}/`, `${join(target, "Assets", "Plugins", "Sirenix")}/`],
    ]);
    expect(statusEvents.at(-1)?.status).toBe("done");
    expect(statusEvents.at(-1)?.detail).toContain("2 package(s) applied");
  });

  it("applies an outside-Assets package under the target's Packages/", async () => {
    const { reporter } = makeFakeReporter();
    await mkdir(join(storeDir, "packages", "Packages", "com.acme.core"), { recursive: true });
    const staged: StagedPackage[] = [{ label: "com.acme.core", relPath: "Packages/com.acme.core", bytes: 1 }];

    await importPackages(target, staged, { reporter, storeDir });

    const streamCalls = rsyncMocks.rsyncCopyStream.mock.calls.map((c) => [c[0], c[1]]);
    expect(streamCalls).toEqual([
      [`${join(storeDir, "packages", "Packages", "com.acme.core")}/`, `${join(target, "Packages", "com.acme.core")}/`],
    ]);
  });

  it("fails fast when a requested package is not in the store slot", async () => {
    const { reporter, statusEvents } = makeFakeReporter();
    const notStaged: StagedPackage[] = [{ label: "SOAP", relPath: "Assets/Soap", bytes: 1 }];

    await importPackages(target, notStaged, { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("failed");
    expect(statusEvents[0]?.error).toContain("Not staged: SOAP");
    expect(rsyncMocks.rsyncCopyStream).not.toHaveBeenCalled();
  });

  it("rejects unsafe relPaths from meta (empty / absolute / ..) without touching the fs", async () => {
    const cases: StagedPackage[][] = [
      [{ label: "Empty",  relPath: "",                            bytes: 1 }],
      [{ label: "Abs",    relPath: "/etc",                        bytes: 1 }],
      [{ label: "Escape", relPath: "Assets/Plugins/../../escaped", bytes: 1 }],
    ];

    for (const staged of cases) {
      const { reporter, statusEvents } = makeFakeReporter();
      await importPackages(target, staged, { reporter, storeDir });
      expect(statusEvents[0]?.status).toBe("failed");
      expect(statusEvents[0]?.error).toContain("Unsafe path");
    }
    expect(rsyncMocks.rsyncCopyStream).not.toHaveBeenCalled();
  });

  it("directory named *.meta is ignored by dangling cleanup", async () => {
    await mkdir(join(target, "Fake.meta"), { recursive: true });
    const confirm = vi.fn().mockResolvedValue(true);
    const { reporter, statusEvents } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm });

    expect(confirm).not.toHaveBeenCalled();
    expect(statusEvents.at(-1)?.status).toBe("done");
  });

  it("empty staged list → skipped", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await importPackages(target, [], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
    expect(rsyncMocks.rsyncCopyStream).not.toHaveBeenCalled();
  });

  it("dangling .meta at the target root removed on confirm accept", async () => {
    const ghostMeta = join(target, "Ghost.meta");
    await writeFile(ghostMeta, "guid: dead", "utf8");
    const confirm = vi.fn().mockResolvedValue(true);
    const { reporter } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm });

    expect(confirm).toHaveBeenCalledOnce();
    await expect(readFile(ghostMeta, "utf8")).rejects.toThrow();
  });

  it("dangling .meta inside the target's Assets/ is also flagged (Assets scan scope)", async () => {
    const ghostMeta = join(target, "Assets", "Ghost.meta");
    await writeFile(ghostMeta, "guid: dead", "utf8");
    const confirm = vi.fn().mockResolvedValue(true);
    const { reporter } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm });

    expect(confirm).toHaveBeenCalledOnce();
    await expect(readFile(ghostMeta, "utf8")).rejects.toThrow();
  });

  it("dangling .meta kept on confirm decline", async () => {
    const ghostMeta = join(target, "Assets", "Ghost.meta");
    await writeFile(ghostMeta, "guid: dead", "utf8");
    const confirm = vi.fn().mockResolvedValue(false);
    const { reporter } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm });

    expect(await readFile(ghostMeta, "utf8")).toBe("guid: dead");
  });

  it(".meta with a matching asset in target is NOT flagged (partial-store safety)", async () => {
    // Soap exists in the TARGET's Assets but was never staged — the v0.1
    // source-diff check would have flagged Soap.meta; the target-self check
    // must not.
    await mkdir(join(target, "Assets", "Soap"), { recursive: true });
    await writeFile(join(target, "Assets", "Soap.meta"), "guid: alive", "utf8");
    const confirm = vi.fn().mockResolvedValue(true);
    const { reporter } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm });

    expect(confirm).not.toHaveBeenCalled(); // no cleanup prompt at all
    expect(await readFile(join(target, "Assets", "Soap.meta"), "utf8")).toBe("guid: alive");
  });

  it("dry-run: rsync gets dryRun, cleanup rm skipped even on accept", async () => {
    const ghostMeta = join(target, "Assets", "Ghost.meta");
    await writeFile(ghostMeta, "guid: dead", "utf8");
    const confirm = vi.fn().mockResolvedValue(true);
    const { reporter } = makeFakeReporter();

    await importPackages(target, STAGED, { reporter, storeDir, confirm, dryRun: true });

    expect(rsyncMocks.rsyncCopyStream).toHaveBeenCalledWith(
      expect.any(String), expect.any(String),
      expect.objectContaining({ dryRun: true }),
    );
    expect(await readFile(ghostMeta, "utf8")).toBe("guid: dead"); // not removed
  });
});
