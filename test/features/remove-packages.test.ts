/**
 * test/features/remove-packages.test.ts — Unit tests for removePackages.
 *
 * Runs against REAL tmp fixtures: a store meta + mirror dirs/sidecars, so
 * deletion of the mirror, the .meta sidecar, and the meta entry are all
 * exercised end to end. No rsync/git involved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SyncStatusEvent, SyncReporter } from "../../src/features/transfer/reporter.js";
import { removePackages } from "../../src/features/packages/remove-packages.js";
import {
  readPackagesStoreMeta,
  writePackagesStoreMeta,
} from "../../src/features/store/store-meta.js";
import type { StagedPackage } from "../../src/features/store/store-meta.js";
import { exists } from "../../src/util/fs-predicates.js";

function makeFakeReporter() {
  const statusEvents: SyncStatusEvent[] = [];
  const reporter: SyncReporter = {
    onStatus(event) { statusEvents.push(event); },
    onProgress()    { /* not asserted */ },
    onLog()         { /* not asserted */ },
  };
  return { reporter, statusEvents };
}

const VFOLDERS: StagedPackage = {
  label: "vFolders", relPath: "vFolders", bytes: 1024,
  sourcePath: "/hub/Assets", sourceName: "hub", branch: "main", stagedAt: "2026-06-09T10:00:00.000Z",
};
const ODIN: StagedPackage = {
  label: "Odin Inspector", relPath: "Plugins/Sirenix", bytes: 4096,
  sourcePath: "/hub/Assets", sourceName: "hub", branch: "main", stagedAt: "2026-06-09T10:00:00.000Z",
};

describe("removePackages", () => {
  let storeDir: string;
  let slot: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `scvn-remove-pkgs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    slot = join(storeDir, "packages");
    await mkdir(join(slot, "vFolders"), { recursive: true });
    await mkdir(join(slot, "Plugins", "Sirenix"), { recursive: true });
    await writeFile(join(slot, "Plugins", "Sirenix.meta"), "guid: 1", "utf8");
    await writePackagesStoreMeta({ kind: "packages", packages: [VFOLDERS, ODIN] }, storeDir);
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("removes a package mirror + sidecar + meta entry; leaves siblings", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["Odin Inspector"], { reporter, storeDir });

    expect(await exists(join(slot, "Plugins", "Sirenix"))).toBe(false);
    expect(await exists(join(slot, "Plugins", "Sirenix.meta"))).toBe(false);
    expect(await exists(join(slot, "vFolders"))).toBe(true);

    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages.map((p) => p.label)).toEqual(["vFolders"]);
    expect(statusEvents.at(-1)?.status).toBe("done");
  });

  it("empty label list → skipped, no writes", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages([], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("unknown label → skipped, nothing removed", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["Nope"], { reporter, storeDir });

    expect(statusEvents.at(-1)?.status).toBe("skipped");
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
    expect(await exists(join(slot, "vFolders"))).toBe(true);
  });

  it("decline confirm → aborted, nothing removed", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["vFolders"], { reporter, storeDir, confirm: () => Promise.resolve(false) });

    expect(statusEvents.at(-1)?.detail).toBe("Aborted");
    expect(await exists(join(slot, "vFolders"))).toBe(true);
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("dry-run: no filesystem or meta writes", async () => {
    const { reporter } = makeFakeReporter();

    await removePackages(["vFolders"], { reporter, storeDir, dryRun: true });

    expect(await exists(join(slot, "vFolders"))).toBe(true);
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("nothing staged → skipped", async () => {
    const { reporter, statusEvents } = makeFakeReporter();
    await writePackagesStoreMeta({ kind: "packages", packages: [] }, storeDir);

    await removePackages(["vFolders"], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
  });

  it("unsafe relPath in meta is left in place (mirror + entry), not deleted", async () => {
    const { reporter } = makeFakeReporter();
    const evil: StagedPackage = { ...ODIN, label: "Evil", relPath: "../escape" };
    await writePackagesStoreMeta({ kind: "packages", packages: [VFOLDERS, evil] }, storeDir);

    await removePackages(["Evil"], { reporter, storeDir });

    // Entry stays because the unsafe path is never processed.
    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages.map((p) => p.label).sort()).toEqual(["Evil", "vFolders"]);
  });
});
