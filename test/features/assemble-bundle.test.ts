/**
 * test/features/assemble-bundle.test.ts — Bundle assembly layout + INSTALL.txt.
 *
 * syncSingleFolder is mocked (its copy is covered by import tests) so this
 * asserts the per-tree calls + the real INSTALL.txt write into a tmp staging.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile, writeFile, chmod, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";

const syncMock = vi.hoisted(() => ({ syncSingleFolder: vi.fn() }));
vi.mock("../../src/features/transfer/sync-single-folder.js", () => syncMock);

import { assembleBundle } from "../../src/features/pack/assemble-bundle.js";

describe("assembleBundle", () => {
  beforeEach(() => syncMock.syncSingleFolder.mockReset().mockResolvedValue(undefined));

  it("copies bin/dist/templates from the install root + store from the user store parent", async () => {
    const staging = await tmpDir("scvn-assemble-");
    const scvnHome = await tmpDir("scvn-home-");
    await mkdir(path.join(scvnHome, "store"), { recursive: true });

    await assembleBundle({
      installRoot:     "/cli",
      userStoreParent: scvnHome,
      stagingDir:      staging,
      version:         "1.2.3",
    });

    // (source, rel) per call — order: bin, dist, templates, then store
    const pairs = syncMock.syncSingleFolder.mock.calls.map((c) => [c[0], c[2]]);
    expect(pairs).toEqual([
      ["/cli", "bin"],
      ["/cli", "dist"],
      ["/cli", "templates"],
      [scvnHome, "store"],
    ]);
    // every copy targets the staging dir
    for (const call of syncMock.syncSingleFolder.mock.calls) {
      expect(call[1]).toBe(staging);
    }
  });

  it("ships an EMPTY store rather than dying when the producer never exported", async () => {
    // pack already warns that such a bundle carries no staged assets. Honor that:
    // rsyncing a directory that was never created exits 23 and kills the pack.
    const staging = await tmpDir("scvn-assemble-");
    const scvnHome = await tmpDir("scvn-home-"); // no store/ inside

    await assembleBundle({
      installRoot:     "/cli",
      userStoreParent: scvnHome,
      stagingDir:      staging,
      version:         "1.2.3",
    });

    const rels = syncMock.syncSingleFolder.mock.calls.map((c) => c[2]);
    expect(rels).not.toContain("store");
    expect((await stat(path.join(staging, "store"))).isDirectory()).toBe(true);
  });

  it("writes INSTALL.txt with the version + unzip/PATH/import steps", async () => {
    const staging = await tmpDir("scvn-assemble-");

    await assembleBundle({
      installRoot: "/cli", userStoreParent: "/home/.scvn", stagingDir: staging, version: "1.2.3",
    });

    const txt = await readFile(path.join(staging, "INSTALL.txt"), "utf8");
    expect(txt).toContain("v1.2.3");
    expect(txt).toContain("scvn packages import --to");
    expect(txt).toContain("PATH");
  });

  it("stages node/bin/node when nodeBinPath is set, leaving the 3-tree copy sequence intact", async () => {
    const staging = await tmpDir("scvn-assemble-");
    const scvnHome = await tmpDir("scvn-home-");
    await mkdir(path.join(scvnHome, "store"), { recursive: true });
    const src = await tmpDir("scvn-node-src-");
    const srcBin = path.join(src, "node");
    await writeFile(srcBin, "NODE", "utf8");
    await chmod(srcBin, 0o755);

    await assembleBundle({
      installRoot: "/cli", userStoreParent: scvnHome, stagingDir: staging, version: "1.2.3",
      nodeBinPath: srcBin,
    });

    // syncSingleFolder tree copies are unchanged (node staging is a separate copyFile)
    const pairs = syncMock.syncSingleFolder.mock.calls.map((c) => [c[0], c[2]]);
    expect(pairs).toEqual([
      ["/cli", "bin"], ["/cli", "dist"], ["/cli", "templates"],
      [scvnHome, "store"],
    ]);
    expect((await stat(path.join(staging, "node", "bin", "node"))).isFile()).toBe(true);
  });

  it("omits node/ when nodeBinPath is not set", async () => {
    const staging = await tmpDir("scvn-assemble-");
    await assembleBundle({
      installRoot: "/cli", userStoreParent: "/home/.scvn", stagingDir: staging, version: "1.2.3",
    });
    await expect(stat(path.join(staging, "node"))).rejects.toThrow();
  });
});
