/**
 * test/features/mcp-bundle.test.ts — Bundling the MCP cache, and resolving it back.
 *
 * The pair has to agree: `stageMcpCache` writes `<bundle>/mcp/...` and
 * `bundledMcpRoot` reads it back from the same place. A test that only asserted
 * one side would let the two drift and only fail on an artist's Mac.
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access, readdir } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import { stageMcpCache } from "../../src/features/pack/mcp-cache-staging.js";
import {
  bundledMcpRoot,
  _setBundledMcpRootForTest,
  _resetBundledMcpCache,
  BUNDLED_MCP_DIRNAME,
} from "../../src/features/mcp/bundled-mcp-paths.js";
import {
  resolveMcpVerDir,
  listStagedVersions,
  resolveUnityMcpCliDir,
  newestStagedVersion,
  writeCacheDir,
} from "../../src/features/mcp/resolve-mcp-cache.js";
import { verDir, verDirName, cliDirName } from "../../src/features/mcp/mcp-cache-paths.js";
import { writeVersionsJson } from "../../src/features/mcp/versions-json.js";
import { CORE_PKG } from "../../src/features/mcp/mcp-constants.js";

const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** A staged version dir, complete with the .tarballs the bundle must NOT ship. */
async function seedVersion(cacheDir: string, version: string): Promise<void> {
  const dir = verDir(version, cacheDir);
  await mkdir(path.join(dir, CORE_PKG, "Editor"), { recursive: true });
  await writeFile(path.join(dir, CORE_PKG, "Editor", "Core.cs"), "// core\n");
  await mkdir(path.join(dir, ".tarballs"), { recursive: true });
  await writeFile(path.join(dir, ".tarballs", `${CORE_PKG}-${version}.tgz`), "PRISTINE-ARCHIVE");
  await writeVersionsJson(dir, {
    core: version,
    packages: { [CORE_PKG]: version },
    fetchedAt: "2026-01-01T00:00:00Z",
  });
}

/**
 * A staged version dir whose addon does NOT pin its core — what a `--force` (or a
 * pre-solver) fetch leaves behind. It is un-installable, and because it is always
 * the HIGHEST version, it wins every newest-first sort unless someone checks.
 */
async function seedSkewedVersion(cacheDir: string, version: string): Promise<void> {
  await seedVersion(cacheDir, version);
  await writeVersionsJson(verDir(version, cacheDir), {
    core: version,
    packages: { [CORE_PKG]: version, [ANIMATION]: "1.2.25" },
    pins: { [ANIMATION]: false },
    fetchedAt: "2026-01-01T00:00:00Z",
  });
}

/** A cached unity-mcp-cli, closure included. */
async function seedCli(cacheDir: string, version: string): Promise<void> {
  const dir = path.join(cacheDir, cliDirName(version));
  await mkdir(path.join(dir, "bin"), { recursive: true });
  await writeFile(path.join(dir, "bin", "unity-mcp-cli.js"), "// cli\n");
  await mkdir(path.join(dir, "node_modules", "chalk"), { recursive: true });
  await writeFile(path.join(dir, "node_modules", "chalk", "index.js"), "export default {};\n");
}

beforeEach(() => {
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
});

describe("stageMcpCache", () => {
  it("bundles the NEWEST version with its ledger and package trees", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedVersion(cacheDir, "0.82.3");
    await seedVersion(cacheDir, "0.82.10");
    await seedCli(cacheDir, "0.82.10");

    const result = await stageMcpCache({ mcpCacheDir: cacheDir, stagingDir: staging });

    expect(result).toEqual({ version: "0.82.10", cliBundled: true });
    const bundled = path.join(staging, BUNDLED_MCP_DIRNAME, verDirName("0.82.10"));
    expect(await exists(path.join(bundled, CORE_PKG, "Editor", "Core.cs"))).toBe(true);
    expect(await exists(path.join(bundled, "versions.json"))).toBe(true);

    // The older version does NOT ship — one version per bundle keeps it small.
    expect(await exists(path.join(staging, BUNDLED_MCP_DIRNAME, verDirName("0.82.3")))).toBe(false);
  });

  it("EXCLUDES .tarballs — producer insurance, dead weight for the consumer", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedVersion(cacheDir, "1.0.0");
    await seedCli(cacheDir, "1.0.0");

    await stageMcpCache({ mcpCacheDir: cacheDir, stagingDir: staging });

    const bundled = path.join(staging, BUNDLED_MCP_DIRNAME, verDirName("1.0.0"));
    expect(await exists(path.join(bundled, ".tarballs"))).toBe(false);
    expect(await readdir(bundled)).toEqual(expect.arrayContaining([CORE_PKG, "versions.json"]));
  });

  it("ships the CLI closure WHOLE — a missing dep is ERR_MODULE_NOT_FOUND on the artist's Mac", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedVersion(cacheDir, "1.0.0");
    await seedCli(cacheDir, "1.0.0");

    await stageMcpCache({ mcpCacheDir: cacheDir, stagingDir: staging });

    const cli = path.join(staging, BUNDLED_MCP_DIRNAME, cliDirName("1.0.0"));
    expect(await exists(path.join(cli, "bin", "unity-mcp-cli.js"))).toBe(true);
    expect(await exists(path.join(cli, "node_modules", "chalk", "index.js"))).toBe(true);
  });

  it("warns (never fails) on an empty cache", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    const warns: string[] = [];

    const result = await stageMcpCache({
      mcpCacheDir: cacheDir,
      stagingDir: staging,
      reporter: {
        onStatus: () => {},
        onLog: (e) => { if (e.level === "warn") warns.push(e.message); },
      },
    });

    expect(result).toEqual({ version: null, cliBundled: false });
    expect(warns.join("\n")).toMatch(/empty/);
    expect(await exists(path.join(staging, BUNDLED_MCP_DIRNAME))).toBe(false);
  });

  it("warns when no CLI is cached — the bundle could not write .mcp.json offline", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedVersion(cacheDir, "1.0.0"); // no seedCli
    const warns: string[] = [];

    const result = await stageMcpCache({
      mcpCacheDir: cacheDir,
      stagingDir: staging,
      reporter: {
        onStatus: () => {},
        onLog: (e) => { if (e.level === "warn") warns.push(e.message); },
      },
    });

    expect(result).toEqual({ version: "1.0.0", cliBundled: false });
    expect(warns.join("\n")).toMatch(/unity-mcp-cli/);
  });

  it("skips a skewed version and bundles the newest INSTALLABLE one instead", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedVersion(cacheDir, "0.83.1");
    await seedCli(cacheDir, "0.83.1");
    await seedSkewedVersion(cacheDir, "0.84.2"); // newest, un-installable
    const warns: string[] = [];

    const result = await stageMcpCache({
      mcpCacheDir: cacheDir,
      stagingDir: staging,
      reporter: {
        onStatus: () => {},
        onLog: (e) => { if (e.level === "warn") warns.push(e.message); },
      },
    });

    // Shipping 0.84.2 would hand the offline artist the one version the install
    // gate refuses — on the machine with no network to fix it.
    expect(result.version).toBe("0.83.1");
    expect(warns.join("\n")).toMatch(/not bundling V0\.84\.2/);
    expect(await exists(path.join(staging, BUNDLED_MCP_DIRNAME, verDirName("0.84.2")))).toBe(false);
  });

  it("ships nothing, and says why, when EVERY staged version is skewed", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const staging = await tmpDir("scvn-staging-");
    await seedSkewedVersion(cacheDir, "0.84.2");
    const warns: string[] = [];

    const result = await stageMcpCache({
      mcpCacheDir: cacheDir,
      stagingDir: staging,
      reporter: {
        onStatus: () => {},
        onLog: (e) => { if (e.level === "warn") warns.push(e.message); },
      },
    });

    expect(result).toEqual({ version: null, cliBundled: false });
    expect(warns.join("\n")).toMatch(/skewed/);
    expect(warns.join("\n")).not.toMatch(/empty/); // the cache is not empty — do not say it is
  });
});

describe("newestStagedVersion — the offline fallback", () => {
  it("skips a skewed version dir when the caller names the addons", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    await seedVersion(cacheDir, "0.83.1");
    await seedSkewedVersion(cacheDir, "0.84.2");

    // Unfiltered, the newest wins — and it is exactly the un-installable one.
    expect(await newestStagedVersion({ userCacheDir: cacheDir })).toBe("0.84.2");
    expect(await newestStagedVersion({ userCacheDir: cacheDir, wantAddons: [ANIMATION] })).toBe(
      "0.83.1",
    );
  });

  it("keeps a dir whose skew is irrelevant to the addons actually wanted", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    await seedSkewedVersion(cacheDir, "0.84.2"); // animation is skewed here

    expect(
      await newestStagedVersion({ userCacheDir: cacheDir, wantAddons: [PARTICLE] }),
    ).toBe("0.84.2");
  });

  it("grandfathers a ledger written before pin tracking", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    await seedVersion(cacheDir, "0.82.4"); // no `pins` key at all

    expect(
      await newestStagedVersion({ userCacheDir: cacheDir, wantAddons: [ANIMATION] }),
    ).toBe("0.82.4");
  });
});

describe("stage → resolve round-trip", () => {
  it("a bundled cache resolves back through the SAME resolver every reader uses", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const bundle = await tmpDir("scvn-bundle-");
    await seedVersion(cacheDir, "0.82.4");
    await seedCli(cacheDir, "0.82.4");

    // Produce the bundle, then consume it as an install root would.
    await stageMcpCache({ mcpCacheDir: cacheDir, stagingDir: bundle });
    _setBundledMcpRootForTest(path.join(bundle, BUNDLED_MCP_DIRNAME));

    const emptyUser = await tmpDir("scvn-empty-");
    const staged = await resolveMcpVerDir("0.82.4", { userCacheDir: emptyUser });
    const cli = await resolveUnityMcpCliDir("0.82.4", { userCacheDir: emptyUser });

    expect(staged?.source).toBe("bundled");
    expect(cli?.source).toBe("bundled");
    expect(await newestStagedVersion({ userCacheDir: emptyUser })).toBe("0.82.4");
  });

  it("the user cache SHADOWS the bundle for the same version", async () => {
    const userCache = await tmpDir("scvn-mcp-cache-");
    const bundleRoot = await tmpDir("scvn-bundle-");
    await seedVersion(userCache, "1.0.0");
    await seedVersion(bundleRoot, "1.0.0");
    await seedVersion(bundleRoot, "0.9.0");
    _setBundledMcpRootForTest(bundleRoot);

    const staged = await resolveMcpVerDir("1.0.0", { userCacheDir: userCache });
    const all = await listStagedVersions({ userCacheDir: userCache });

    expect(staged?.source).toBe("user");
    expect(all).toEqual([
      { version: "1.0.0", source: "user", dir: verDir("1.0.0", userCache) },
      { version: "0.9.0", source: "bundled", dir: verDir("0.9.0", bundleRoot) },
    ]);
  });

  it("writes ALWAYS target the user cache — a bundle is a read-only artifact", async () => {
    const userCache = await tmpDir("scvn-mcp-cache-");
    _setBundledMcpRootForTest(await tmpDir("scvn-bundle-"));

    expect(writeCacheDir({ userCacheDir: userCache })).toBe(userCache);
  });
});

describe("bundledMcpRoot", () => {
  it("finds a sibling mcp/ next to templates/ in the install root", async () => {
    const root = await tmpDir("scvn-install-");
    await mkdir(path.join(root, "templates"), { recursive: true });
    await mkdir(path.join(root, BUNDLED_MCP_DIRNAME), { recursive: true });

    expect(await bundledMcpRoot(root)).toBe(path.join(root, BUNDLED_MCP_DIRNAME));
  });

  it("resolves null when no bundled cache ships (a plain dev checkout)", async () => {
    const root = await tmpDir("scvn-install-");
    await mkdir(path.join(root, "templates"), { recursive: true });

    expect(await bundledMcpRoot(root)).toBeNull();
  });
});
