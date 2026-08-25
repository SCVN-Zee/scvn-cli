/**
 * test/features/mcp-fetch-version.test.ts — Staging a version: fetch → verify → extract →
 * transform → publish, plus the offline fast path in ensureStaged.
 *
 * Real tarballs, real hashes, real `tar`, no network.
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import { fakeRegistry } from "../helpers/mcp-registry-fake.js";
import type { FakePackage } from "../helpers/mcp-registry-fake.js";
import { makeCoreFixture, makeAddonFixture, EDITOR_ASSET_LOADER_REL } from "../helpers/mcp-fixtures.js";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import { fetchVersion } from "../../src/features/mcp/fetch-version.js";
import { ensureStaged } from "../../src/features/mcp/ensure-staged.js";
import { verDir } from "../../src/features/mcp/mcp-cache-paths.js";
import { readVersionsJson, writeVersionsJson } from "../../src/features/mcp/versions-json.js";
import { _setBundledMcpRootForTest, _resetBundledMcpCache } from "../../src/features/mcp/bundled-mcp-paths.js";
import { CORE_PKG, PPX_PKG } from "../../src/features/mcp/mcp-constants.js";

const CORE_VER = "0.82.4";
const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";

function catalog(): FakePackage[] {
  return [
    {
      name: CORE_PKG,
      version: CORE_VER,
      build: makeCoreFixture,
      dependencies: { [PPX_PKG]: "2.1.5" },
    },
    { name: ANIMATION, version: "1.2.24", build: makeAddonFixture, pinsCore: CORE_VER },
    { name: PARTICLE, version: "1.1.9", build: makeAddonFixture, pinsCore: CORE_VER },
    { name: PPX_PKG, version: "2.1.5", build: makeAddonFixture },
  ];
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null); // no bundle unless a test says so
});

describe("fetchVersion", () => {
  it("stages core + addons + ppx, transformed, with a versions.json ledger", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir, ...registry });

    const dir = verDir(CORE_VER, cacheDir);
    expect(await exists(path.join(dir, CORE_PKG))).toBe(true);
    expect(await exists(path.join(dir, ANIMATION))).toBe(true);
    expect(await exists(path.join(dir, PPX_PKG))).toBe(true);

    // The core arrived transformed — this is the whole point of staging.
    const loader = await readFile(path.join(dir, CORE_PKG, EDITOR_ASSET_LOADER_REL), "utf8");
    expect(loader).toContain("Assets/UnityMCP/com.ivanmurzak.unity.mcp/");
    expect(await exists(path.join(dir, CORE_PKG, "Tests"))).toBe(false);

    const doc = await readVersionsJson(dir);
    expect(doc.core).toBe(CORE_VER);
    expect(doc.packages[ANIMATION]).toBe("1.2.24");
    expect(doc.pins?.[ANIMATION]).toBe(true);
    // core and ppx are not addons — a pin verdict would be meaningless.
    expect(doc.pins).not.toHaveProperty(CORE_PKG);
    expect(doc.pins).not.toHaveProperty(PPX_PKG);
  });

  it("keeps the pristine tarballs as re-extraction insurance", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await fetchVersion(CORE_VER, [], { cacheDir, ...registry });

    const tarballs = await readdir(path.join(verDir(CORE_VER, cacheDir), ".tarballs"));
    expect(tarballs).toContain(`${CORE_PKG}-${CORE_VER}.tgz`);
  });

  it("refuses a tampered tarball and publishes nothing", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    registry.tamper(CORE_PKG);

    await expect(fetchVersion(CORE_VER, [], { cacheDir, ...registry })).rejects.toThrow(
      /integrity MISMATCH/i,
    );

    expect(await exists(verDir(CORE_VER, cacheDir))).toBe(false);
    expect(await readdir(cacheDir)).toEqual([]); // not even a staging dir survives
  });

  it("leaves a previously staged version intact when a re-stage fails", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const good = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [], { cacheDir, ...good });

    _resetPackumentCache();
    const bad = await fakeRegistry(catalog());
    bad.tamper(CORE_PKG);
    await expect(
      fetchVersion(CORE_VER, [ANIMATION], { cacheDir, ...bad }),
    ).rejects.toThrow(/integrity/i);

    // The old dir is still there and still complete — the atomic publish is why.
    const doc = await readVersionsJson(verDir(CORE_VER, cacheDir));
    expect(doc.packages[CORE_PKG]).toBe(CORE_VER);
  });

  it("throws on an empty core version rather than staging `Unity-MCP V`", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await expect(fetchVersion("", [], { cacheDir, ...registry })).rejects.toThrow(
      /empty core version/,
    );
  });

  it("dry-run resolves versions but writes nothing", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    const resolved = await fetchVersion(CORE_VER, [ANIMATION], {
      cacheDir,
      dryRun: true,
      ...registry,
    });

    expect(resolved.map((p) => p.name)).toEqual([CORE_PKG, ANIMATION, PPX_PKG]);
    expect(registry.fetchBinary).not.toHaveBeenCalled();
    expect(await readdir(cacheDir)).toEqual([]);
  });

  it("refuses a core whose source drifted — a broken core never reaches the cache", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const drifted = catalog();
    drifted[0]!.build = async (dir) => {
      await mkdir(path.join(dir, path.dirname(EDITOR_ASSET_LOADER_REL)), { recursive: true });
      await writeFile(path.join(dir, EDITOR_ASSET_LOADER_REL), "class X {}\n");
    };
    const registry = await fakeRegistry(drifted);

    await expect(fetchVersion(CORE_VER, [], { cacheDir, ...registry })).rejects.toThrow(/DRIFT/);
    expect(await exists(verDir(CORE_VER, cacheDir))).toBe(false);
  });
});

describe("ensureStaged", () => {
  it("fast path: a complete version fetches nothing (the offline bundle-install path)", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir, ...registry });
    registry.fetchBinary.mockClear();
    registry.fetchImpl.mockClear();

    const result = await ensureStaged(CORE_VER, [ANIMATION], { cacheDir, ...registry });

    expect(result.alreadyStaged).toBe(true);
    expect(registry.fetchBinary).not.toHaveBeenCalled();
    expect(registry.fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches a version that is not staged at all", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    const result = await ensureStaged(CORE_VER, [ANIMATION], { cacheDir, ...registry });

    expect(result.alreadyStaged).toBe(false);
    expect(await exists(path.join(verDir(CORE_VER, cacheDir), ANIMATION))).toBe(true);
  });

  it("re-stages with the UNION — adding an addon never strips another repo's", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir, ...registry });

    // A second repo wants particlesystem from the SAME version dir.
    await ensureStaged(CORE_VER, [PARTICLE], { cacheDir, ...registry });

    const doc = await readVersionsJson(verDir(CORE_VER, cacheDir));
    expect(Object.keys(doc.packages).sort()).toEqual(
      [CORE_PKG, ANIMATION, PARTICLE, PPX_PKG].sort(),
    );
    // The first repo's addon survived — a plain overwrite would have dropped it.
    expect(await exists(path.join(verDir(CORE_VER, cacheDir), ANIMATION))).toBe(true);
  });

  it("re-fetches when the version dir exists but its ledger is missing", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await mkdir(verDir(CORE_VER, cacheDir), { recursive: true }); // half-cleaned slot

    const result = await ensureStaged(CORE_VER, [], { cacheDir, ...registry });

    expect(result.alreadyStaged).toBe(false);
    expect(await readVersionsJson(verDir(CORE_VER, cacheDir))).toMatchObject({ core: CORE_VER });
  });

  it("counts a BUNDLED version as staged and fetches nothing", async () => {
    // The artist-Mac path: empty user cache, a bundle, no network.
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    const registry = await fakeRegistry(catalog());
    const result = await ensureStaged(CORE_VER, [ANIMATION], { cacheDir, ...registry });

    expect(result.alreadyStaged).toBe(true);
    expect(result.dir).toBe(verDir(CORE_VER, bundleRoot));
    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });

  it("throws on an empty core version", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await expect(ensureStaged("", [], { cacheDir, ...registry })).rejects.toThrow(/empty core/);
  });
});

describe("ensureStaged — cache dir carrying a space", () => {
  it("stages into `Unity-MCP V<ver>` under a spaced cache path", async () => {
    const root = await tmpDir("scvn-mcp-cache-");
    const cacheDir = path.join(root, "with space");
    await mkdir(cacheDir, { recursive: true });
    const registry = await fakeRegistry(catalog());

    await ensureStaged(CORE_VER, [], { cacheDir, ...registry });

    expect(await exists(path.join(cacheDir, `Unity-MCP V${CORE_VER}`, CORE_PKG))).toBe(true);
  });
});

describe("versions.json seeded by hand", () => {
  it("is read back as staged (no fetch) — the shape is a stable contract", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const dir = verDir("9.9.9", cacheDir);
    await mkdir(path.join(dir, CORE_PKG), { recursive: true });
    await writeVersionsJson(dir, {
      core: "9.9.9",
      packages: { [CORE_PKG]: "9.9.9" },
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    const registry = await fakeRegistry(catalog());

    const result = await ensureStaged("9.9.9", [], { cacheDir, ...registry });

    expect(result.alreadyStaged).toBe(true);
    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });
});
