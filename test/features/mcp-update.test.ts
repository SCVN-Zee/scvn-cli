/**
 * test/features/mcp-update.test.ts — Version bumps and rollback.
 *
 * The cache keeps ONLY the latest staged version: every fetch prunes the older
 * version dirs. So a rollback to an older `<coreVer>` RE-FETCHES it — asserted
 * by a registry whose fetch is observed (online) or throws (offline refusal).
 *
 * And the asymmetry with install: a bare `update` with the registry down must
 * REFUSE, never quietly resolve backwards to a local version.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access, stat } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { fakeRegistry } from "../helpers/mcp-registry-fake.js";
import type { FakePackage } from "../helpers/mcp-registry-fake.js";
import { makeCoreFixture, makeAddonFixture } from "../helpers/mcp-fixtures.js";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import {
  _setBundledMcpRootForTest,
  _resetBundledMcpCache,
} from "../../src/features/mcp/bundled-mcp-paths.js";
import { installMcp } from "../../src/features/mcp/install-mcp.js";
import { updateMcp } from "../../src/features/mcp/update-mcp.js";
import { fetchVersion } from "../../src/features/mcp/fetch-version.js";
import { markerVersion, markerPackages, importRoot } from "../../src/features/mcp/marker.js";
import { CORE_PKG, PPX_PKG, MACHINERY_FILES } from "../../src/features/mcp/mcp-constants.js";
import { listVerDirs, verDir } from "../../src/features/mcp/mcp-cache-paths.js";

const OLD_VER = "0.82.3";
const NEW_VER = "0.82.4";
const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";

vi.mock("../../src/detectors/detect-unity-running.js", () => ({
  detectUnityRunning: vi.fn(async () => false),
}));
vi.mock("../../src/features/mcp/invoke-setup-mcp.js", () => ({
  invokeSetupMcp: vi.fn(async () => true),
}));
vi.mock("../../src/features/mcp/resolve-unity-mcp-cli.js", () => ({
  ensureUnityMcpCli: vi.fn(async (core: string) => ({
    dir: "/cache/cli",
    version: core,
    alreadyStaged: true,
  })),
}));

/** A registry publishing BOTH versions; `latest` is whichever is listed last. */
function catalog(coreVersion: string): FakePackage[] {
  return [
    {
      name: CORE_PKG,
      version: coreVersion,
      build: makeCoreFixture,
      dependencies: { [PPX_PKG]: "2.1.5" },
    },
    { name: ANIMATION, version: "1.2.24", build: makeAddonFixture, pinsCore: coreVersion },
    { name: PARTICLE, version: "1.1.9", build: makeAddonFixture, pinsCore: coreVersion },
    { name: PPX_PKG, version: "2.1.5", build: makeAddonFixture },
  ];
}

async function makeRepo(): Promise<{ repo: string; project: string; target: string }> {
  const repo = await tmpDir("scvn-repo-");
  await mkdir(path.join(repo, "Assets"), { recursive: true });
  await mkdir(path.join(repo, "Packages"), { recursive: true });
  await mkdir(path.join(repo, "ProjectSettings"), { recursive: true });
  await execa("git", ["init", "-q"], { cwd: repo });
  await execa("git", ["config", "user.email", "t@e.c"], { cwd: repo });
  await execa("git", ["config", "user.name", "t"], { cwd: repo });
  for (const file of MACHINERY_FILES) {
    await writeFile(path.join(repo, file), "{}\n");
  }
  await execa("git", ["add", "-A"], { cwd: repo });
  await execa("git", ["commit", "-qm", "init"], { cwd: repo });
  return { repo, project: repo, target: path.join(repo, "Assets") };
}

/** A registry whose every call throws — proves a code path is genuinely offline. */
function offlineRegistry() {
  const boom = async () => {
    throw new Error("network is down");
  };
  return { fetchImpl: vi.fn(boom), fetchBinary: vi.fn(boom) };
}

function collect() {
  const warns: string[] = [];
  const logs: string[] = [];
  return {
    reporter: {
      onStatus: () => {},
      onLog: (e: { level: string; message: string }) => {
        logs.push(e.message);
        if (e.level === "warn") warns.push(e.message);
      },
    },
    warns,
    logs,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function porcelain(repo: string): Promise<string> {
  const { stdout } = await execa("git", ["-C", repo, "status", "--porcelain"]);
  return stdout.trim();
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
});

describe("updateMcp — domain", () => {
  it("REFUSES a project without MCP installed, and names `install`", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog(NEW_VER));

    await expect(updateMcp({ target, cacheDir, ...registry })).rejects.toThrow(
      /does not have MCP installed/,
    );
    await expect(updateMcp({ target, cacheDir, ...registry })).rejects.toThrow(/install/);
  });

  it("short-circuits at the current version, writing NOTHING", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });
    const before = await stat(path.join(importRoot(project), CORE_PKG));
    const { reporter, logs } = collect();

    await updateMcp({ target, cacheDir, coreVersion: NEW_VER, reporter, ...registry });

    expect(logs.join("\n")).toMatch(/already at/);
    const after = await stat(path.join(importRoot(project), CORE_PKG));
    expect(after.mtimeMs).toBe(before.mtimeMs); // nothing was re-imported
    expect(await porcelain(repo)).toBe("");
  });

  it("--force re-imports at the same version", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    await updateMcp({ target, cacheDir, coreVersion: NEW_VER, force: true, ...registry });

    expect(await markerVersion(project)).toBe(NEW_VER);
    expect(await exists(path.join(importRoot(project), CORE_PKG))).toBe(true);
  });
});

describe("updateMcp — rollback re-fetches (cache keeps only the latest)", () => {
  it("keeps ONLY the latest version staged — installing NEW prunes OLD", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");

    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await fetchVersion(OLD_VER, [ANIMATION], { cacheDir, ...oldReg });
    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, coreVersion: NEW_VER, addons: [ANIMATION], ...newReg });

    expect(await markerVersion(project)).toBe(NEW_VER);
    // The newer fetch pruned the older version dir — the cache is single-version.
    expect(await listVerDirs(cacheDir)).toEqual([NEW_VER]);
    expect(await exists(verDir(OLD_VER, cacheDir))).toBe(false);
  });

  it("rolls back to an older version by RE-FETCHING it (rollback needs the network)", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");

    const newReg = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, coreVersion: NEW_VER, addons: [ANIMATION], ...newReg });
    expect(await markerVersion(project)).toBe(NEW_VER);

    // The old version was pruned, so rolling back must fetch it again.
    _resetPackumentCache();
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await updateMcp({ target, cacheDir, coreVersion: OLD_VER, ...oldReg });

    expect(await markerVersion(project)).toBe(OLD_VER);
    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(oldReg.fetchBinary).toHaveBeenCalled();
    // The rollback fetch pruned NEW in turn — still single-version.
    expect(await listVerDirs(cacheDir)).toEqual([OLD_VER]);
    expect(await porcelain(repo)).toBe("");
  });

  it("REFUSES an offline rollback — the older version is no longer cached", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");

    const newReg = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, coreVersion: NEW_VER, addons: [ANIMATION], ...newReg });

    _resetPackumentCache();
    const offline = offlineRegistry();
    await expect(
      updateMcp({ target, cacheDir, coreVersion: OLD_VER, ...offline }),
    ).rejects.toThrow(/network is down/);
  });

  it("carries the marker's exact package set across the bump", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await installMcp({
      target,
      cacheDir,
      coreVersion: OLD_VER,
      addons: [ANIMATION, PARTICLE],
      ...oldReg,
    });

    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER));
    await updateMcp({ target, cacheDir, coreVersion: NEW_VER, ...newReg });

    expect(await markerVersion(project)).toBe(NEW_VER);
    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, PARTICLE, PPX_PKG].sort(),
    );
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(true);
  });
});

describe("updateMcp — a bare update never downgrades", () => {
  it("REFUSES when the registry is unreachable, instead of falling back to a local version", async () => {
    // The asymmetry with install: install's job is "get me working", so using a
    // good cache is right. update's job is "move me forward" — resolving
    // backwards would be a silent downgrade.
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    _resetPackumentCache();
    const offline = offlineRegistry();

    await expect(updateMcp({ target, cacheDir, ...offline })).rejects.toThrow(
      /never falls back|silently downgrade/i,
    );
    // The install is untouched.
    expect(await markerVersion(project)).toBe(NEW_VER);
  });

  it("points at the explicit-version form as the way to roll back", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog(NEW_VER));
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    _resetPackumentCache();
    await expect(updateMcp({ target, cacheDir, ...offlineRegistry() })).rejects.toThrow(
      /scvn mcp update <coreVer>/,
    );
  });

  it("resolves registry latest when it IS reachable", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await installMcp({ target, cacheDir, coreVersion: OLD_VER, addons: [ANIMATION], ...oldReg });

    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER)); // dist-tags.latest = NEW_VER
    await updateMcp({ target, cacheDir, ...newReg });

    expect(await markerVersion(project)).toBe(NEW_VER);
  });
});

describe("updateMcp — --addons is warn-ignored", () => {
  it("keeps the marker's set and warns, rather than silently adding a package", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await installMcp({ target, cacheDir, coreVersion: OLD_VER, addons: [ANIMATION], ...oldReg });
    const { reporter, warns } = collect();

    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER));
    await updateMcp({
      target,
      cacheDir,
      coreVersion: NEW_VER,
      addons: [PARTICLE],
      reporter,
      ...newReg,
    });

    expect(warns.join("\n")).toMatch(/--addons ignored/);
    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
  });
});

describe("updateMcp — dry run", () => {
  it("previews honestly when the target version is not staged, writing nothing", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await installMcp({ target, cacheDir, coreVersion: OLD_VER, addons: [ANIMATION], ...oldReg });
    const { reporter, logs } = collect();

    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER));
    await updateMcp({
      target,
      cacheDir,
      coreVersion: NEW_VER,
      dryRun: true,
      reporter,
      ...newReg,
    });

    expect(logs.join("\n")).toMatch(/would fetch/);
    expect(newReg.fetchBinary).not.toHaveBeenCalled();
    expect(await markerVersion(project)).toBe(OLD_VER); // still on the old one
  });

  it("previews the attach when the target IS staged, writing nothing", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const oldReg = await fakeRegistry(catalog(OLD_VER));
    await installMcp({ target, cacheDir, coreVersion: OLD_VER, addons: [ANIMATION], ...oldReg });
    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog(NEW_VER));
    await fetchVersion(NEW_VER, [ANIMATION], { cacheDir, ...newReg });

    await updateMcp({ target, cacheDir, coreVersion: NEW_VER, dryRun: true, ...newReg });

    expect(await markerVersion(project)).toBe(OLD_VER); // unchanged
  });
});
