/**
 * test/features/clean-machine-import.test.ts — Bundled-store acceptance.
 *
 * Simulates a teammate's clean machine: an empty user store + a bundled store
 * (what `make pack` ships). Proves the resolver falls back to the bundled root
 * and the import handler applies packages FROM the bundled slot — i.e. the
 * producer layout (Phase 02) satisfies the consumer resolver (Phase 01).
 * Copy is mocked (covered by the handler unit tests); existence guards run real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";

const copyPkgMock = vi.hoisted(() => ({ copyPackage: vi.fn() }));
vi.mock("../../src/features/packages/copy-package.js", () => copyPkgMock);

import { writePackagesStoreMeta } from "../../src/features/store/store-meta.js";
import { resolveEffectiveStoreDir } from "../../src/features/store/resolve-store-dir.js";
import {
  _setBundledStoreRootForTest,
  _resetBundledStoreCache,
} from "../../src/features/store/bundled-store-paths.js";
import { importPackages } from "../../src/features/packages/import-packages.js";

afterEach(() => {
  _resetBundledStoreCache();
  vi.clearAllMocks();
});

describe("clean machine: empty user store falls back to the bundled store", () => {
  beforeEach(() => {
    copyPkgMock.copyPackage.mockResolvedValue(undefined);
  });

  it("resolves bundled for packages and applies them from the bundled slot", async () => {
    const bundled   = await tmpDir("scvn-bundled-");
    const emptyUser = await tmpDir("scvn-emptyuser-");
    const target    = await tmpDir("scvn-target-");

    // Seed the bundled store exactly as `make pack` ships it: store/packages.
    await mkdir(path.join(bundled, "packages", "vFolders"), { recursive: true });
    await writePackagesStoreMeta({
      kind: "packages", sourcePath: "/hub/Assets", sourceName: "hub",
      branch: "main", exportedAt: "2026-06-12T00:00:00.000Z", bytes: 10,
      packages: [{ label: "vFolders", relPath: "vFolders", bytes: 10 }],
    }, bundled);

    _setBundledStoreRootForTest(bundled);

    // Empty user store → resolver picks the bundled root for packages.
    const pk = await resolveEffectiveStoreDir("packages", { userStoreDir: emptyUser });
    expect(pk).toEqual({ storeDir: bundled, source: "bundled" });

    // Handler applies FROM the bundled slot (source path under the bundled root).
    await importPackages(target, [{ label: "vFolders", relPath: "vFolders", bytes: 10 }], { storeDir: pk!.storeDir });

    expect(copyPkgMock.copyPackage).toHaveBeenCalledWith(
      path.join(bundled, "packages"), target, "vFolders", false, expect.anything(),
    );
  });
});
