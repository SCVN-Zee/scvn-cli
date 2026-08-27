/**
 * test/features/remove-packages.test.ts — Unit tests for removePackages.
 *
 * Runs against REAL tmp fixtures: a store meta + mirror dirs/sidecars, so
 * deletion of the mirror, the .meta sidecar, and the meta entry are all
 * exercised end to end. No rsync/git involved. Fixtures are v2-shaped
 * (version: 2 metas, root-relative relPaths) so no migration ever fires.
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
    onStatus: (event) => { statusEvents.push(event); },
    onLog:    () => {},
  };
  return { reporter, statusEvents };
}

const VFOLDERS: StagedPackage = {
  label: "vFolders", relPath: "Assets/vFolders", bytes: 1024,
  sourcePath: "/hub", sourceName: "hub", branch: "main", stagedAt: "2026-06-09T10:00:00.000Z",
};
const ODIN: StagedPackage = {
  label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 4096,
  sourcePath: "/hub", sourceName: "hub", branch: "main", stagedAt: "2026-06-09T10:00:00.000Z",
};

describe("removePackages", () => {
  let storeDir: string;
  let slot: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `scvn-remove-pkgs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    slot = join(storeDir, "packages");
    await mkdir(join(slot, "Assets", "vFolders"), { recursive: true });
    await mkdir(join(slot, "Assets", "Plugins", "Sirenix"), { recursive: true });
    await writeFile(join(slot, "Assets", "Plugins", "Sirenix.meta"), "guid: 1", "utf8");
    await writePackagesStoreMeta({ kind: "packages", version: 2, packages: [VFOLDERS, ODIN] }, storeDir);
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("removes a package mirror + sidecar + meta entry; leaves siblings", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["Assets/Plugins/Sirenix"], { reporter, storeDir });

    expect(await exists(join(slot, "Assets", "Plugins", "Sirenix"))).toBe(false);
    expect(await exists(join(slot, "Assets", "Plugins", "Sirenix.meta"))).toBe(false);
    expect(await exists(join(slot, "Assets", "vFolders"))).toBe(true);

    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages.map((p) => p.relPath)).toEqual(["Assets/vFolders"]);
    expect(statusEvents.at(-1)?.status).toBe("done");
  });

  it("empty relPath list → skipped, no writes", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages([], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("unknown relPath → skipped, nothing removed", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["Packages/Nope"], { reporter, storeDir });

    expect(statusEvents.at(-1)?.status).toBe("skipped");
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
    expect(await exists(join(slot, "Assets", "vFolders"))).toBe(true);
  });

  it("decline confirm → aborted, nothing removed", async () => {
    const { reporter, statusEvents } = makeFakeReporter();

    await removePackages(["Assets/vFolders"], { reporter, storeDir, confirm: () => Promise.resolve(false) });

    expect(statusEvents.at(-1)?.detail).toBe("Aborted");
    expect(await exists(join(slot, "Assets", "vFolders"))).toBe(true);
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("dry-run: no filesystem or meta writes", async () => {
    const { reporter } = makeFakeReporter();

    await removePackages(["Assets/vFolders"], { reporter, storeDir, dryRun: true });

    expect(await exists(join(slot, "Assets", "vFolders"))).toBe(true);
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });

  it("nothing staged → skipped", async () => {
    const { reporter, statusEvents } = makeFakeReporter();
    await writePackagesStoreMeta({ kind: "packages", version: 2, packages: [] }, storeDir);

    await removePackages(["Assets/vFolders"], { reporter, storeDir });

    expect(statusEvents[0]?.status).toBe("skipped");
  });

  it("unsafe relPath in meta is left in place (mirror + entry), not deleted", async () => {
    const { reporter } = makeFakeReporter();
    const evil: StagedPackage = { ...ODIN, label: "Evil", relPath: "../escape" };
    await writePackagesStoreMeta({ kind: "packages", version: 2, packages: [VFOLDERS, evil] }, storeDir);

    await removePackages(["../escape"], { reporter, storeDir });

    // Entry stays because the unsafe path is never processed.
    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.packages.map((p) => p.relPath).sort()).toEqual(["../escape", "Assets/vFolders"]);
  });
});
