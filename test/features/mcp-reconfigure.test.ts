/**
 * test/features/mcp-reconfigure.test.ts — Atomic addon-set edits on an installed project.
 *
 * install's marker short-circuit refuses to change the addon set. reconfigure
 * is the opposite branch: an already-installed project is reconciled to a NEW
 * want. The version dir is a shared cache, so a same-core bump must re-stage
 * the UNION of currently-staged addons — never just the requested set.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
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
import { reconfigureMcp } from "../../src/features/mcp/reconfigure-mcp.js";
import { fetchVersion } from "../../src/features/mcp/fetch-version.js";
import {
  markerVersion,
  markerPackages,
  readMarker,
  importRoot,
} from "../../src/features/mcp/marker.js";
import { NoCoherentCoreError } from "../../src/features/mcp/resolve-coherent-core.js";
import { CORE_PKG, PPX_PKG, MACHINERY_FILES } from "../../src/features/mcp/mcp-constants.js";
import { verDir } from "../../src/features/mcp/mcp-cache-paths.js";
import { readVersionsJson } from "../../src/features/mcp/versions-json.js";

const CORE_VER = "0.82.4";
const NEWER_CORE = "0.83.0";
const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";
const TIMELINE = "com.ivanmurzak.unity.mcp.timeline";
const ANIM_OLD = "1.2.24";
const ANIM_NEW = "1.2.25";

vi.mock("../../src/detectors/detect-unity-running.js", () => ({
  detectUnityRunning: vi.fn(async () => false),
}));
vi.mock("../../src/features/mcp/invoke-setup-mcp.js", () => ({
  invokeSetupMcp: vi.fn(async () => true),
}));
vi.mock("../../src/features/mcp/resolve-unity-mcp-cli.js", () => ({
  ensureUnityMcpCli: vi.fn(async (core: string) => ({
    dir: "/cache/unity-mcp-cli",
    version: core,
    alreadyStaged: true,
  })),
}));

import { detectUnityRunning } from "../../src/detectors/detect-unity-running.js";

function addonBuild(tag: string): (dir: string) => Promise<void> {
  return async (dir) => {
    await makeAddonFixture(dir);
    // Payloads MUST differ in size: rsync -a skips same-size, same-mtime files.
    const payload = tag === ANIM_NEW ? `// addon NEW ${tag}\n`.repeat(4) : `// addon ${tag}\n`;
    await writeFile(path.join(dir, "Editor/Addon.cs"), payload);
    if (tag === ANIM_NEW) {
      await writeFile(path.join(dir, "Editor/bumped.txt"), "bumped\n");
    }
  };
}

function catalog(opts: { animVersion?: string; includeTimeline?: boolean } = {}): FakePackage[] {
  const animVersion = opts.animVersion ?? ANIM_OLD;
  const packages: FakePackage[] = [
    {
      name: CORE_PKG,
      version: CORE_VER,
      build: makeCoreFixture,
      dependencies: { [PPX_PKG]: "2.1.5" },
    },
    {
      name: ANIMATION,
      version: animVersion,
      build: addonBuild(animVersion),
      pinsCore: CORE_VER,
    },
    { name: PARTICLE, version: "1.1.9", build: makeAddonFixture, pinsCore: CORE_VER },
    { name: PPX_PKG, version: "2.1.5", build: makeAddonFixture },
  ];
  if (opts.includeTimeline) {
    packages.push({
      name: TIMELINE,
      version: "1.0.0",
      build: makeAddonFixture,
      pinsCore: CORE_VER,
    });
  }
  return packages;
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

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
  vi.mocked(detectUnityRunning).mockResolvedValue(false);
});

describe("reconfigureMcp — addon set", () => {
  it("adds AND drops addons; the marker reflects exactly the new set", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog({ includeTimeline: true }));

    await installMcp({
      target,
      cacheDir,
      addons: [ANIMATION, PARTICLE],
      ...registry,
    });
    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, PARTICLE, PPX_PKG].sort(),
    );

    await reconfigureMcp({
      target,
      cacheDir,
      addons: [ANIMATION, TIMELINE],
      ...registry,
    });

    const dest = importRoot(project);
    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, TIMELINE, PPX_PKG].sort(),
    );
    expect(await exists(path.join(dest, ANIMATION))).toBe(true);
    expect(await exists(path.join(dest, TIMELINE))).toBe(true);
    expect(await exists(path.join(dest, PARTICLE))).toBe(false);
    expect(await markerVersion(project)).toBe(CORE_VER);
  });

  it("without --addons preserves the marker's current set (no shrink to defaults)", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog({ includeTimeline: true }));

    // Install a NON-default set — timeline is not in DEFAULT_ADDONS.
    await installMcp({ target, cacheDir, addons: [ANIMATION, TIMELINE], ...registry });
    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, TIMELINE, PPX_PKG].sort(),
    );

    // No addons → must carry the marker set forward, NOT fall back to the seed
    // (which would drop timeline and add particlesystem).
    await reconfigureMcp({ target, cacheDir, ...registry });

    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, TIMELINE, PPX_PKG].sort(),
    );
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
  });
});

describe("reconfigureMcp — explicit core version", () => {
  // The tab's version chooser can name a core the add-ons don't pin. reconfigure
  // honors it (skipping the coherent solve); the pin-skew gate still refuses it
  // unless `force` is passed — the same "allow + force" contract as install.
  function twoCoreRegistry() {
    return fakeRegistry([
      ...catalog(),
      {
        name: CORE_PKG,
        version: NEWER_CORE,
        build: makeCoreFixture,
        dependencies: { [PPX_PKG]: "2.1.5" },
      },
    ]);
  }

  it("honors an explicit core with force, vendoring the chosen core over the coherent cap", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await twoCoreRegistry();

    // animation only pins CORE_VER, so the coherent install caps there.
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });
    expect(await markerVersion(project)).toBe(CORE_VER);

    await reconfigureMcp({
      target,
      cacheDir,
      addons: [ANIMATION],
      coreVersion: NEWER_CORE,
      force: true,
      ...registry,
    });

    expect(await markerVersion(project)).toBe(NEWER_CORE);
  });

  it("refuses a skewed explicit core without force; the marker stays on the coherent core", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await twoCoreRegistry();

    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    await expect(
      reconfigureMcp({ target, cacheDir, addons: [ANIMATION], coreVersion: NEWER_CORE, ...registry }),
    ).rejects.toThrow();

    expect(await markerVersion(project)).toBe(CORE_VER);
  });
});

describe("reconfigureMcp — same-core addon bump", () => {
  it("copies new files and updates the marker version", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");

    const oldReg = await fakeRegistry(catalog({ animVersion: ANIM_OLD }));
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...oldReg });
    expect((await readMarker(project))?.packages[ANIMATION]).toBe(ANIM_OLD);

    _resetPackumentCache();
    const newReg = await fakeRegistry(catalog({ animVersion: ANIM_NEW }));
    await reconfigureMcp({ target, cacheDir, addons: [ANIMATION], ...newReg });

    const dest = importRoot(project);
    expect(await exists(path.join(dest, ANIMATION, "Editor/bumped.txt"))).toBe(true);
    const body = await readFile(path.join(dest, ANIMATION, "Editor/Addon.cs"), "utf8");
    expect(body).toContain("NEW");
    expect((await readMarker(project))?.packages[ANIMATION]).toBe(ANIM_NEW);
    expect(await markerVersion(project)).toBe(CORE_VER);
  });
});

describe("reconfigureMcp — shared-cache survival", () => {
  it("keeps project A's addon in the version dir after project B drops it", async () => {
    const projectA = await makeRepo();
    const projectB = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");

    const oldReg = await fakeRegistry(
      catalog({ animVersion: ANIM_OLD, includeTimeline: true }),
    );
    await fetchVersion(CORE_VER, [ANIMATION, TIMELINE], { cacheDir, ...oldReg });
    await installMcp({
      target: projectA.target,
      cacheDir,
      addons: [ANIMATION, TIMELINE],
      ...oldReg,
    });
    await installMcp({
      target: projectB.target,
      cacheDir,
      addons: [ANIMATION, TIMELINE],
      ...oldReg,
    });

    _resetPackumentCache();
    const newReg = await fakeRegistry(
      catalog({ animVersion: ANIM_NEW, includeTimeline: true }),
    );
    await reconfigureMcp({
      target: projectB.target,
      cacheDir,
      addons: [ANIMATION],
      ...newReg,
    });

    const shared = verDir(CORE_VER, cacheDir);
    expect(await exists(path.join(shared, TIMELINE))).toBe(true);
    const doc = await readVersionsJson(shared);
    expect(doc.packages[TIMELINE]).toBeDefined();
    expect(doc.packages[ANIMATION]).toBe(ANIM_NEW);

    expect(await exists(path.join(importRoot(projectB.project), TIMELINE))).toBe(false);
    expect(await markerPackages(projectB.project)).toEqual(
      [CORE_PKG, ANIMATION, PPX_PKG].sort(),
    );
    expect(await exists(path.join(importRoot(projectA.project), TIMELINE))).toBe(true);
  });
});

describe("reconfigureMcp — refusals", () => {
  it("surfaces NoCoherentCoreError and leaves the project untouched", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const packages: FakePackage[] = [
      {
        name: CORE_PKG,
        version: CORE_VER,
        build: makeCoreFixture,
        dependencies: { [PPX_PKG]: "2.1.5" },
      },
      {
        name: CORE_PKG,
        version: NEWER_CORE,
        build: makeCoreFixture,
        dependencies: { [PPX_PKG]: "2.1.5" },
      },
      { name: ANIMATION, version: ANIM_OLD, build: makeAddonFixture, pinsCore: CORE_VER },
      { name: TIMELINE, version: "1.0.0", build: makeAddonFixture, pinsCore: NEWER_CORE },
      { name: PPX_PKG, version: "2.1.5", build: makeAddonFixture },
    ];
    const registry = await fakeRegistry(packages);

    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });
    const before = await markerPackages(project);
    const dest = importRoot(project);

    await expect(
      reconfigureMcp({ target, cacheDir, addons: [ANIMATION, TIMELINE], ...registry }),
    ).rejects.toBeInstanceOf(NoCoherentCoreError);

    expect(await markerPackages(project)).toEqual(before);
    expect(await exists(path.join(dest, ANIMATION))).toBe(true);
    expect(await exists(path.join(dest, TIMELINE))).toBe(false);
  });

  it("refuses an uninstalled target and names `install`", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await expect(reconfigureMcp({ target, cacheDir, addons: [ANIMATION], ...registry })).rejects.toThrow(
      /does not have MCP installed/,
    );
    await expect(reconfigureMcp({ target, cacheDir, addons: [ANIMATION], ...registry })).rejects.toThrow(
      /install/,
    );
  });

  it("refuses while Unity is running when force is false", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    vi.mocked(detectUnityRunning).mockResolvedValue(true);

    await expect(
      reconfigureMcp({ target, cacheDir, addons: [ANIMATION], force: false, ...registry }),
    ).rejects.toThrow(/Unity.*running/i);
  });
});
