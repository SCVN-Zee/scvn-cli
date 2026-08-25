/**
 * test/features/bundled-store-paths.test.ts — Locate a CLI-bundled store.
 *
 * Real walk driven from tmp trees (sibling store/ present vs absent) plus the
 * test override + cache-reset plumbing the resolver and acceptance tests use.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  bundledStoreRoot,
  bundledStoreExists,
  _setBundledStoreRootForTest,
  _resetBundledStoreCache,
} from "../../src/features/store/bundled-store-paths.js";
import { _resetInstallRoot } from "../../src/util/install-root.js";

afterEach(() => {
  _resetBundledStoreCache();
  _resetInstallRoot(); // real probe caches the install root too — clear both
});

describe("bundledStoreRoot", () => {
  it("resolves <install-root>/store when store/ ships beside templates/", async () => {
    const root = await tmpDir("scvn-bundle-");
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, "store"), { recursive: true });
    const start = path.join(root, "dist");
    await mkdir(start, { recursive: true });

    expect(await bundledStoreRoot(start)).toBe(path.join(root, "store"));
  });

  it("returns null when the install root has no sibling store/", async () => {
    const root = await tmpDir("scvn-bundle-");
    await mkdir(path.join(root, "templates"), { recursive: true });
    const start = path.join(root, "dist");
    await mkdir(start, { recursive: true });

    expect(await bundledStoreRoot(start)).toBeNull();
  });

  it("returns null in a tree with no install root", async () => {
    const root = await tmpDir("scvn-bundle-");
    const start = path.join(root, "x");
    await mkdir(start, { recursive: true });

    expect(await bundledStoreRoot(start)).toBeNull();
  });

  it("honours the test override and cache reset", async () => {
    _setBundledStoreRootForTest("/forced/store");
    expect(await bundledStoreRoot()).toBe("/forced/store");
    expect(await bundledStoreExists()).toBe(true);

    _setBundledStoreRootForTest(null);
    expect(await bundledStoreExists()).toBe(false);

    // After a reset the real probe runs against this dev tree (no <root>/store).
    _resetBundledStoreCache();
    expect(await bundledStoreRoot()).toBeNull();
  });
});
