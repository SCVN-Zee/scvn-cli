/**
 * test/features/store-meta-migration.test.ts — v1→v2 store migration.
 *
 * Runs against REAL tmp stores. v1 metas (no version field) carry
 * Assets-relative relPaths with mirrors at <store>/packages/<relPath>; the
 * first read migrates them to the v2 project-root-relative identity
 * (Assets/<relPath>) by moving mirrors through an out-of-namespace staging
 * dir under a durable phase marker.
 *
 * The alias fixture is the load-bearing case: v1 `Foo` and v1 `Assets/Foo`
 * staged side by side — one package's OLD mirror path is the other's NEW
 * path, so an in-place (or wrongly ordered) per-package rename would swap
 * or wedge their contents. The two-phase staging must keep every mirror
 * under its own identity.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackagesStoreMeta } from "../../src/features/store/store-meta.js";
import { getPackagesStoreMetaPath } from "../../src/features/store/store-paths.js";
import { exists } from "../../src/util/fs-predicates.js";
import type { StagedPackage } from "../../src/features/store/store-meta.js";

const STAGED_AT = "2026-06-09T10:00:00.000Z";

function v1Entry(label: string, relPath: string): StagedPackage {
  return {
    label,
    relPath,
    bytes: 1,
    sourcePath: "/projects/hub/Assets",
    sourceName: "hub",
    branch: "main",
    stagedAt: STAGED_AT,
  };
}

async function writeV1Meta(storeDir: string, packages: StagedPackage[]): Promise<void> {
  await mkdir(join(storeDir, "packages"), { recursive: true });
  await writeFile(
    getPackagesStoreMetaPath(storeDir),
    JSON.stringify({ kind: "packages", packages }, null, 2) + "\n",
    "utf8",
  );
}

/** Mirror writer against an arbitrary base (the packages slot or staging). */
async function writeMirror(base: string, relPath: string, content: string): Promise<void> {
  const dir = join(base, ...relPath.split("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "payload.txt"), content, "utf8");
}

async function readPayload(storeDir: string, relPath: string): Promise<string> {
  return readFile(join(storeDir, "packages", ...relPath.split("/"), "payload.txt"), "utf8");
}

describe("store v1→v2 migration", () => {
  let root: string;
  let storeDir: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scvn-store-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    storeDir = join(root, "store");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("migrates identities, mirrors, sidecars, and sourcePath; persists version 2", async () => {
    await writeV1Meta(storeDir, [v1Entry("vFolders", "vFolders"), v1Entry("Odin Inspector", "Plugins/Sirenix")]);
    await writeMirror(join(storeDir, "packages"), "vFolders", "vfolders-content");
    await writeMirror(join(storeDir, "packages"), "Plugins/Sirenix", "odin-content");
    await writeFile(join(storeDir, "packages", "Plugins", "Sirenix.meta"), "guid: 1", "utf8");

    const meta = await readPackagesStoreMeta(storeDir);

    expect(meta?.version).toBe(2);
    expect(meta?.packages.map((p) => [p.label, p.relPath, p.sourcePath])).toEqual([
      ["vFolders", "Assets/vFolders", "/projects/hub"],
      ["Odin Inspector", "Assets/Plugins/Sirenix", "/projects/hub"],
    ]);
    expect(await readPayload(storeDir, "Assets/vFolders")).toBe("vfolders-content");
    expect(await readPayload(storeDir, "Assets/Plugins/Sirenix")).toBe("odin-content");
    expect(await readFile(join(storeDir, "packages", "Assets", "Plugins", "Sirenix.meta"), "utf8")).toBe("guid: 1");

    // Scratch (staging + phase marker) is cleaned up, and a second read is stable.
    expect(await exists(join(storeDir, ".packages-v2-staging"))).toBe(false);
    expect(await exists(join(storeDir, ".packages-v2-phase1"))).toBe(false);
    const again = await readPackagesStoreMeta(storeDir);
    expect(again).toEqual(meta);
  });

  it("always prefixes Assets/ — a v1 Assets/Foo (source Assets/Assets/Foo) becomes Assets/Assets/Foo", async () => {
    await writeV1Meta(storeDir, [v1Entry("Nested", "Assets/Foo")]);
    await writeMirror(join(storeDir, "packages"), "Assets/Foo", "nested-content");

    const meta = await readPackagesStoreMeta(storeDir);

    expect(meta?.packages[0]?.relPath).toBe("Assets/Assets/Foo");
    expect(await readPayload(storeDir, "Assets/Assets/Foo")).toBe("nested-content");
  });

  it("alias fixture: v1 Foo and v1 Assets/Foo coexist under distinct v2 identities", async () => {
    await writeV1Meta(storeDir, [
      v1Entry("Foo", "Foo"),
      v1Entry("AssetsFoo", "Assets/Foo"),
    ]);
    await writeMirror(join(storeDir, "packages"), "Foo", "plain-foo");
    await writeMirror(join(storeDir, "packages"), "Assets/Foo", "assets-foo");

    const meta = await readPackagesStoreMeta(storeDir);

    const byLabel = new Map(meta?.packages.map((p) => [p.label, p.relPath]));
    expect(byLabel.get("Foo")).toBe("Assets/Foo");
    expect(byLabel.get("AssetsFoo")).toBe("Assets/Assets/Foo");
    expect(await readPayload(storeDir, "Assets/Foo")).toBe("plain-foo");
    expect(await readPayload(storeDir, "Assets/Assets/Foo")).toBe("assets-foo");
  });

  it("nested fixture: a package staged inside another package's mirror rides along", async () => {
    await writeV1Meta(storeDir, [
      v1Entry("Foo", "Foo"),
      v1Entry("Inner", "Foo/X"),
    ]);
    await writeMirror(join(storeDir, "packages"), "Foo", "outer");
    await writeMirror(join(storeDir, "packages"), "Foo/X", "inner");

    const meta = await readPackagesStoreMeta(storeDir);

    const byLabel = new Map(meta?.packages.map((p) => [p.label, p.relPath]));
    expect(byLabel.get("Foo")).toBe("Assets/Foo");
    expect(byLabel.get("Inner")).toBe("Assets/Foo/X");
    expect(await readPayload(storeDir, "Assets/Foo/X")).toBe("inner");
  });

  it("resumes from a crashed phase 2 via the phase marker without re-running phase 1", async () => {
    // v1 Foo + Assets/Foo alias pair. Simulate the crash: phase 1 completed
    // (marker written, everything in staging), ONE phase-2 final done (Foo),
    // meta still v1. The retry must not mistake Foo's final Assets/Foo for
    // AssetsFoo's old mirror.
    await writeV1Meta(storeDir, [
      v1Entry("Foo", "Foo"),
      v1Entry("AssetsFoo", "Assets/Foo"),
    ]);
    const staging = join(storeDir, ".packages-v2-staging");
    await writeMirror(staging, "Foo", "plain-foo");
    await writeMirror(staging, "Assets/Foo", "assets-foo");
    // Foo's phase-2 final already in place; its staging source vacated.
    await writeMirror(join(storeDir, "packages"), "Assets/Foo", "plain-foo");
    await rm(join(staging, "Foo"), { recursive: true, force: true });
    await writeFile(join(storeDir, ".packages-v2-phase1"), "", "utf8");

    const meta = await readPackagesStoreMeta(storeDir);

    const byLabel = new Map(meta?.packages.map((p) => [p.label, p.relPath]));
    expect(byLabel.get("Foo")).toBe("Assets/Foo");
    expect(byLabel.get("AssetsFoo")).toBe("Assets/Assets/Foo");
    expect(await readPayload(storeDir, "Assets/Foo")).toBe("plain-foo");
    expect(await readPayload(storeDir, "Assets/Assets/Foo")).toBe("assets-foo");
    expect(await exists(join(storeDir, ".packages-v2-phase1"))).toBe(false);
  });

  it("sweeps scratch left by a crash in the post-meta window on a v2 read", async () => {
    await writeV1Meta(storeDir, [v1Entry("vFolders", "vFolders")]);
    await writeMirror(join(storeDir, "packages"), "vFolders", "content");
    // First read migrates fully…
    const meta = await readPackagesStoreMeta(storeDir);
    expect(meta?.version).toBe(2);
    // …then a crash-before-cleanup leaves the marker behind.
    await writeFile(join(storeDir, ".packages-v2-phase1"), "", "utf8");

    await expect(readPackagesStoreMeta(storeDir)).resolves.toEqual(meta);
    expect(await exists(join(storeDir, ".packages-v2-phase1"))).toBe(false);
  });

  it("migrates the legacy single-slot meta shape straight to v2", async () => {
    await mkdir(join(storeDir, "packages"), { recursive: true });
    await writeFile(
      getPackagesStoreMetaPath(storeDir),
      JSON.stringify({
        kind: "packages",
        sourcePath: "/projects/hub/Assets",
        sourceName: "hub",
        branch: "main",
        exportedAt: STAGED_AT,
        packages: [
          { label: "vFolders", relPath: "vFolders", bytes: 2 },
        ],
      }) + "\n",
      "utf8",
    );
    await writeMirror(join(storeDir, "packages"), "vFolders", "content");

    const meta = await readPackagesStoreMeta(storeDir);

    expect(meta?.version).toBe(2);
    expect(meta?.packages).toEqual([
      { label: "vFolders", relPath: "Assets/vFolders", bytes: 2,
        sourcePath: "/projects/hub", sourceName: "hub", branch: "main", stagedAt: STAGED_AT },
    ]);
  });

  it("missing mirrors migrate meta-only (store re-added later)", async () => {
    await writeV1Meta(storeDir, [v1Entry("Ghost", "Ghost/Ghost")]);

    const meta = await readPackagesStoreMeta(storeDir);

    expect(meta?.packages[0]?.relPath).toBe("Assets/Ghost/Ghost");
  });

  it("sidecar-only entry (mirror dir deleted, .meta left) migrates without crashing", async () => {
    await writeV1Meta(storeDir, [v1Entry("Odin Inspector", "Plugins/Sirenix")]);
    // No mirror dir — only the .meta sidecar remains at the old location.
    await mkdir(join(storeDir, "packages", "Plugins"), { recursive: true });
    await writeFile(join(storeDir, "packages", "Plugins", "Sirenix.meta"), "guid: 1", "utf8");

    const meta = await readPackagesStoreMeta(storeDir);

    expect(meta?.packages[0]?.relPath).toBe("Assets/Plugins/Sirenix");
    expect(
      await readFile(join(storeDir, "packages", "Assets", "Plugins", "Sirenix.meta"), "utf8"),
    ).toBe("guid: 1");
  });
});

