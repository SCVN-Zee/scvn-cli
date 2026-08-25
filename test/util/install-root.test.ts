/**
 * test/util/install-root.test.ts — Walk-up resolution of the install root.
 *
 * Drives findInstallRoot from an explicit start dir (override path, not cached)
 * against tmp trees so the proven walk is exercised hermetically.
 */

import { describe, it, expect } from "vitest";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import { findInstallRoot } from "../../src/util/install-root.js";

describe("findInstallRoot", () => {
  it("walks up to the nearest ancestor holding templates/", async () => {
    const root = await tmpDir("scvn-install-root-");
    await mkdir(path.join(root, "templates"), { recursive: true });
    const start = path.join(root, "dist", "util");
    await mkdir(start, { recursive: true });

    expect(await findInstallRoot(start)).toBe(root);
  });

  it("matches templates/ at the start dir itself", async () => {
    const root = await tmpDir("scvn-install-root-");
    await mkdir(path.join(root, "templates"), { recursive: true });

    expect(await findInstallRoot(root)).toBe(root);
  });

  it("returns null when no ancestor has templates/", async () => {
    const root = await tmpDir("scvn-install-root-");
    const start = path.join(root, "a", "b");
    await mkdir(start, { recursive: true });

    expect(await findInstallRoot(start)).toBeNull();
  });
});
