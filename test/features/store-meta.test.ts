/**
 * test/features/store-meta.test.ts — Library meta.json round-trip, migration,
 * upsert (add), and remove.
 *
 * Uses a tmp store-root override per test (DI pattern from store-paths.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readPackagesStoreMeta,
  writePackagesStoreMeta,
  upsertPackagesStoreMeta,
  removePackagesStoreEntries,
} from "../../src/features/store/store-meta.js";
import type { PackagesStoreMeta, StagedPackage } from "../../src/features/store/store-meta.js";
import { getPackagesStoreMetaPath } from "../../src/features/store/store-paths.js";

const VFOLDERS: StagedPackage = {
  label:      "vFolders",
  relPath:    "Assets/vFolders",
  bytes:      1_048_576,
  sourcePath: "/projects/hub",
  sourceName: "hub",
  branch:     "main",
  stagedAt:   "2026-06-09T10:00:00.000Z",
};
const ODIN: StagedPackage = {
  label:      "Odin Inspector",
  relPath:    "Assets/Plugins/Sirenix",
  bytes:      51_380_224,
  sourcePath: "/projects/hub",
  sourceName: "hub",
  branch:     "main",
  stagedAt:   "2026-06-09T10:00:00.000Z",
};
const SOAP: StagedPackage = {
  label:      "SOAP",
  relPath:    "Assets/Soap",
  bytes:      2_048,
  sourcePath: "/projects/game",
  sourceName: "game",
  branch:     null,
  stagedAt:   "2026-06-20T12:00:00.000Z",
};

const LIBRARY: PackagesStoreMeta = { kind: "packages", version: 2, packages: [VFOLDERS, ODIN] };

/** A legacy single-slot meta: top-level provenance, packages without their own. */
const LEGACY_META = {
  kind:       "packages",
  sourcePath: "/projects/hub/Assets",
  sourceName: "hub",
  branch:     "release",
  exportedAt: "2026-05-01T08:00:00.000Z",
  bytes:      52_428_800,
  packages: [
     { label: "vFolders",       relPath: "vFolders",        bytes: 1_048_576 },
    { label: "Odin Inspector", relPath: "Plugins/Sirenix", bytes: 51_380_224 },
  ],
};

/** A foreign (non-packages) meta shape, to prove the reader rejects on kind mismatch. */
const FOREIGN_META = {
  kind:       "toolkit",
  sourcePath: "/projects/hub",
  packages:   [],
};

describe("store-meta", () => {
  let storeDir: string;

  beforeEach(async () => {
    storeDir = join(tmpdir(), `scvn-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(storeDir, { recursive: true, force: true });
  });

  it("library meta round-trips including per-package provenance", async () => {
    await writePackagesStoreMeta(LIBRARY, storeDir);
    const read = await readPackagesStoreMeta(storeDir);
    expect(read).toEqual(LIBRARY);
    expect(read?.packages).toHaveLength(2);
  });

  it("write creates the slot directory when absent", async () => {
    await writePackagesStoreMeta(LIBRARY, storeDir);
    const raw = await readFile(getPackagesStoreMetaPath(storeDir), "utf8");
    expect(raw).toContain('"kind": "packages"');
  });

  it("read returns null when nothing staged (missing file)", async () => {
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("read returns null on corrupt JSON", async () => {
    await mkdir(join(storeDir, "packages"), { recursive: true });
    await writeFile(getPackagesStoreMetaPath(storeDir), "{not json", "utf8");
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("read returns null on kind mismatch (foreign meta shape)", async () => {
    await mkdir(join(storeDir, "packages"), { recursive: true });
    await writeFile(getPackagesStoreMetaPath(storeDir), JSON.stringify(FOREIGN_META), "utf8");
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("read returns null when packages[] is missing or not an array", async () => {
    await mkdir(join(storeDir, "packages"), { recursive: true });
    await writeFile(getPackagesStoreMetaPath(storeDir), JSON.stringify({ kind: "packages" }), "utf8");
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();

    await writeFile(
      getPackagesStoreMetaPath(storeDir),
      JSON.stringify({ kind: "packages", packages: "not-an-array" }),
      "utf8",
    );
    expect(await readPackagesStoreMeta(storeDir)).toBeNull();
  });

  it("migrates a legacy single-slot meta to per-package provenance", async () => {
    await mkdir(join(storeDir, "packages"), { recursive: true });
    await writeFile(getPackagesStoreMetaPath(storeDir), JSON.stringify(LEGACY_META), "utf8");
    const read = await readPackagesStoreMeta(storeDir);
    expect(read).not.toBeNull();
    expect(read?.version).toBe(2);
    expect(read?.packages).toHaveLength(2);
    for (const pkg of read!.packages) {
      // Legacy provenance inherited + v1→v2 identity migration: sourcePath
      // points at the project root, relPaths gain the Assets/ prefix.
      expect(pkg.sourcePath).toBe("/projects/hub");
      expect(pkg.sourceName).toBe("hub");
      expect(pkg.branch).toBe("release");
      expect(pkg.stagedAt).toBe("2026-05-01T08:00:00.000Z");
      expect(pkg.relPath.startsWith("Assets/")).toBe(true);
    }
  });

  it("upsert merges by relPath, appends new paths, and keeps other sources", async () => {
    await writePackagesStoreMeta(LIBRARY, storeDir); // vFolders, Odin (hub)
    const merged = await upsertPackagesStoreMeta([SOAP], storeDir); // add from a different source
    expect(merged.packages.map((p) => p.relPath)).toEqual([
      "Assets/vFolders",
      "Assets/Plugins/Sirenix",
      "Assets/Soap",
    ]);
    expect(merged.packages[2]).toEqual(SOAP);

    // Re-adding an existing relPath updates it in place (no duplicate, same position).
    const reAdded = await upsertPackagesStoreMeta(
      [{ ...VFOLDERS, bytes: 999, stagedAt: "2026-07-01T00:00:00.000Z" }],
      storeDir,
    );
    expect(reAdded.packages.map((p) => p.relPath)).toEqual([
      "Assets/vFolders",
      "Assets/Plugins/Sirenix",
      "Assets/Soap",
    ]);
    expect(reAdded.packages[0]?.bytes).toBe(999);
  });

  it("upsert keeps packages with the same label but different relPaths", async () => {
    const assetsFoo: StagedPackage = {
      ...VFOLDERS,
      label: "Foo",
      relPath: "Assets/Foo",
    };
    const packagesFoo: StagedPackage = {
      ...SOAP,
      label: "Foo",
      relPath: "Packages/Foo",
      sourcePath: "/projects/hub",
      sourceName: "hub",
    };
    const merged = await upsertPackagesStoreMeta([assetsFoo, packagesFoo], storeDir);
    expect(merged.packages.map((p) => p.relPath)).toEqual(["Assets/Foo", "Packages/Foo"]);
    expect(merged.packages.map((p) => p.label)).toEqual(["Foo", "Foo"]);
  });

  it("upsert into an empty store writes just the new entries", async () => {
    const merged = await upsertPackagesStoreMeta([SOAP], storeDir);
    expect(merged.packages).toEqual([SOAP]);
    expect(await readPackagesStoreMeta(storeDir)).toEqual({ kind: "packages", version: 2, packages: [SOAP] });
  });

  it("remove drops only named relPaths and returns the removed entries", async () => {
    await writePackagesStoreMeta({ kind: "packages", version: 2, packages: [VFOLDERS, ODIN, SOAP] }, storeDir);
    const removed = await removePackagesStoreEntries(["Assets/Plugins/Sirenix"], storeDir);
    expect(removed).toEqual([ODIN]);
    const read = await readPackagesStoreMeta(storeDir);
    expect(read?.packages.map((p) => p.relPath)).toEqual(["Assets/vFolders", "Assets/Soap"]);
  });

  it("remove of an absent relPath is a no-op returning []", async () => {
    await writePackagesStoreMeta(LIBRARY, storeDir);
    const removed = await removePackagesStoreEntries(["Packages/Nope"], storeDir);
    expect(removed).toEqual([]);
    expect((await readPackagesStoreMeta(storeDir))?.packages).toHaveLength(2);
  });
});
