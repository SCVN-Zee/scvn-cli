/**
 * test/features/resolve-store-dir.test.ts — Effective-store precedence matrix.
 *
 * Real readers against tmp user stores (DI via userStoreDir) + a forced bundled
 * probe. Covers: override wins, user-meta-present → user, empty/absent user →
 * bundled, neither → null, and the packages empty[] = nothing-staged rule.
 */

import { describe, it, expect, afterEach } from "vitest";
import { tmpDir } from "../helpers/tmp-dir.js";
import { writePackagesStoreMeta } from "../../src/features/store/store-meta.js";
import type { PackagesStoreMeta } from "../../src/features/store/store-meta.js";
import { resolveEffectiveStoreDir } from "../../src/features/store/resolve-store-dir.js";
import {
  _setBundledStoreRootForTest,
  _resetBundledStoreCache,
} from "../../src/features/store/bundled-store-paths.js";

const PACKAGES_META: PackagesStoreMeta = {
  kind: "packages", sourcePath: "/p/hub/Assets", sourceName: "hub",
  branch: null, exportedAt: "2026-06-10T03:00:00.000Z", bytes: 1000,
  packages: [{ label: "vFolders", relPath: "vFolders", bytes: 1000 }],
};
const EMPTY_PACKAGES_META: PackagesStoreMeta = { ...PACKAGES_META, packages: [] };

afterEach(() => _resetBundledStoreCache());

describe("resolveEffectiveStoreDir", () => {
  it("explicit override wins outright", async () => {
    _setBundledStoreRootForTest("/bundled/store");
    expect(await resolveEffectiveStoreDir("packages", { override: "/explicit" }))
      .toEqual({ storeDir: "/explicit", source: "override" });
  });

  it("user store with the feature's meta → user root (bundled ignored)", async () => {
    const user = await tmpDir("scvn-user-");
    await writePackagesStoreMeta(PACKAGES_META, user);
    _setBundledStoreRootForTest("/bundled/store");

    expect(await resolveEffectiveStoreDir("packages", { userStoreDir: user }))
      .toEqual({ storeDir: user, source: "user" });
  });

  it("empty user store but bundled present → bundled root", async () => {
    const user = await tmpDir("scvn-user-");
    _setBundledStoreRootForTest("/bundled/store");

    expect(await resolveEffectiveStoreDir("packages", { userStoreDir: user }))
      .toEqual({ storeDir: "/bundled/store", source: "bundled" });
  });

  it("neither user nor bundled → null", async () => {
    const user = await tmpDir("scvn-user-");
    _setBundledStoreRootForTest(null);

    expect(await resolveEffectiveStoreDir("packages", { userStoreDir: user })).toBeNull();
  });

  it("empty packages[] in user meta counts as nothing staged → bundled", async () => {
    const user = await tmpDir("scvn-user-");
    await writePackagesStoreMeta(EMPTY_PACKAGES_META, user);
    _setBundledStoreRootForTest("/bundled/store");

    expect(await resolveEffectiveStoreDir("packages", { userStoreDir: user }))
      .toEqual({ storeDir: "/bundled/store", source: "bundled" });
  });
});
