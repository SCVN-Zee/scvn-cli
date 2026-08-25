/**
 * test/features/mcp-install.test.ts — The install/uninstall lifecycle.
 *
 * Real git repos, real rsync, real cache, injected network. The headline
 * assertion is the one the whole design exists for: after an install,
 * `git status --porcelain` is EMPTY. Vendoring as source means UPM never moves,
 * and the vendored tree itself is fenced out of git — so there is nothing to
 * commit, on any repo, ever.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, readFile, access, realpath } from "node:fs/promises";
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
import { uninstallMcp } from "../../src/features/mcp/uninstall-mcp.js";
import { fetchVersion } from "../../src/features/mcp/fetch-version.js";
import { markerVersion, markerPackages, importRoot } from "../../src/features/mcp/marker.js";
import { getGitInfoExcludePath } from "../../src/services/git.js";
import {
  CORE_PKG,
  PPX_PKG,
  MACHINERY_FILES,
  NUGET_SUBDIR,
} from "../../src/features/mcp/mcp-constants.js";

const CORE_VER = "0.82.4";
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
    dir: "/cache/unity-mcp-cli",
    version: core,
    alreadyStaged: true,
  })),
}));

import { detectUnityRunning } from "../../src/detectors/detect-unity-running.js";
import { invokeSetupMcp } from "../../src/features/mcp/invoke-setup-mcp.js";

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

/** A git repo holding a Unity project (optionally nested, like the luna layout). */
async function makeRepo(nested = false): Promise<{
  repo: string;
  project: string;
  target: string;
}> {
  const repo = await tmpDir("scvn-repo-");
  const project = nested ? path.join(repo, "unity_project", "game") : repo;
  await mkdir(path.join(project, "Assets"), { recursive: true });
  await mkdir(path.join(project, "Packages"), { recursive: true });
  await mkdir(path.join(project, "ProjectSettings"), { recursive: true });
  await execa("git", ["init", "-q"], { cwd: repo });
  await execa("git", ["config", "user.email", "t@e.c"], { cwd: repo });
  await execa("git", ["config", "user.name", "t"], { cwd: repo });
  for (const file of MACHINERY_FILES) {
    await writeFile(path.join(project, file), "{}\n");
  }
  await writeFile(path.join(project, "Assets", "Game.cs"), "// game\n");
  await execa("git", ["add", "-A"], { cwd: repo });
  await execa("git", ["commit", "-qm", "init"], { cwd: repo });
  return { repo, project, target: path.join(project, "Assets") };
}

async function porcelain(repo: string): Promise<string> {
  const { stdout } = await execa("git", ["-C", repo, "status", "--porcelain"]);
  return stdout.trim();
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function excludeText(repo: string): Promise<string> {
  const file = await getGitInfoExcludePath(repo);
  return file ? readFile(file, "utf8").catch(() => "") : "";
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

beforeEach(() => {
  vi.clearAllMocks();
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
  vi.mocked(detectUnityRunning).mockResolvedValue(false);
  vi.mocked(invokeSetupMcp).mockResolvedValue(true);
});

describe("installMcp — clean install", () => {
  it("vendors the source, fences it, markers it, and leaves git EMPTY", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await installMcp({ target, cacheDir, ...registry });

    // Vendored source present.
    const dest = importRoot(project);
    expect(await exists(path.join(dest, CORE_PKG))).toBe(true);
    expect(await exists(path.join(dest, ANIMATION))).toBe(true);
    expect(await exists(path.join(dest, PARTICLE))).toBe(true);
    expect(await exists(path.join(dest, PPX_PKG))).toBe(true);

    // The core arrived transformed (the cache did that, not the project).
    const loader = await readFile(
      path.join(dest, CORE_PKG, "Editor/Scripts/Utils/EditorAssetLoader.cs"),
      "utf8",
    );
    expect(loader).toContain("Assets/UnityMCP/com.ivanmurzak.unity.mcp/");

    // Marker = the lockfile.
    expect(await markerVersion(project)).toBe(CORE_VER);
    expect(await markerPackages(project)).toEqual(
      [CORE_PKG, ANIMATION, PARTICLE, PPX_PKG].sort(),
    );

    // THE assertion: nothing to commit. Thousands of vendored files, zero in git.
    expect(await porcelain(repo)).toBe("");

    // .mcp.json was delegated to the CLI, with the PROJECT dir (not the repo root).
    expect(invokeSetupMcp).toHaveBeenCalledWith(
      expect.objectContaining({ unityProjectDir: await realpath(project) }),
    );
  });

  it("fences the vendored paths, anchored at the repo root for a NESTED project", async () => {
    const { repo, target } = await makeRepo(true);
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await installMcp({ target, cacheDir, ...registry });
    const text = await excludeText(repo);

    expect(text).toContain("# >>> scvn mcp >>>");
    expect(text).toContain("/unity_project/game/Assets/UnityMCP/");
    expect(text).toContain("/unity_project/game/Assets/UnityMCP.meta");
    expect(text).toContain("/unity_project/game/Assets/Plugins/NuGet/");
    expect(text).toContain("/unity_project/game/.mcp.json");
    expect(await porcelain(repo)).toBe("");
  });

  it("fences .mcp.json — the install creates it, so the install must hide it", async () => {
    // A real unity-mcp-cli writes .mcp.json into the project dir. Left unfenced it
    // shows up as an untracked file, which breaks the promise the whole feature
    // rests on: after an install there is genuinely nothing to commit.
    for (const nested of [false, true]) {
      const { repo, project, target } = await makeRepo(nested);
      const cacheDir = await tmpDir("scvn-mcp-cache-");
      const registry = await fakeRegistry(catalog());
      vi.mocked(invokeSetupMcp).mockImplementation(async () => {
        await writeFile(path.join(project, ".mcp.json"), '{"mcpServers":{}}\n');
        return true;
      });

      await installMcp({ target, cacheDir, ...registry });

      expect(await exists(path.join(project, ".mcp.json"))).toBe(true);
      expect(await porcelain(repo)).toBe("");
      _resetPackumentCache();
    }
  });

  it("keeps the machinery files byte-equal to HEAD", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await installMcp({ target, cacheDir, ...registry });

    for (const file of MACHINERY_FILES) {
      const { stdout } = await execa("git", ["-C", repo, "diff", "--", path.join(project, file)]);
      expect(stdout).toBe("");
    }
  });

  it("installs only the requested addons", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
  });

  it("dry-run writes nothing at all", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await installMcp({ target, cacheDir, dryRun: true, ...registry });

    expect(await exists(importRoot(project))).toBe(false);
    expect(await porcelain(repo)).toBe("");
    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });
});

describe("installMcp — gates", () => {
  it("REFUSES an already-installed project and names `update`", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, ...registry });

    await expect(installMcp({ target, cacheDir, ...registry })).rejects.toThrow(
      /already has MCP installed/,
    );
    await expect(installMcp({ target, cacheDir, ...registry })).rejects.toThrow(/update/);
  });

  it("refuses BEFORE any network — an installed project is told so, not 'registry down'", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, ...registry });
    registry.fetchImpl.mockClear();
    registry.fetchBinary.mockClear();

    await expect(installMcp({ target, cacheDir, ...registry })).rejects.toThrow(/already/);

    expect(registry.fetchImpl).not.toHaveBeenCalled();
  });

  it("--force re-installs, taking its package set from the MARKER not --addons", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });
    const { reporter, warns } = collect();

    await installMcp({
      target,
      cacheDir,
      addons: [PARTICLE], // ignored — the marker is the lockfile
      force: true,
      reporter,
      ...registry,
    });

    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
    expect(warns.join("\n")).toMatch(/--addons ignored/);
  });

  it("refuses while Unity is running, unless --force", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    vi.mocked(detectUnityRunning).mockResolvedValue(true);

    await expect(installMcp({ target, cacheDir, ...registry })).rejects.toThrow(/Unity.*running/i);

    await expect(
      installMcp({ target, cacheDir, force: true, ...registry }),
    ).resolves.toBeUndefined();
  });

  it("previews under -n even while Unity is running (the version is already staged)", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION, PARTICLE], { cacheDir, ...registry });
    vi.mocked(detectUnityRunning).mockResolvedValue(true);
    const { reporter, warns } = collect();

    await expect(
      installMcp({ target, cacheDir, dryRun: true, reporter, ...registry }),
    ).resolves.toBeUndefined();

    expect(warns.join("\n")).toMatch(/Unity/);
    expect(await exists(importRoot(project))).toBe(false); // previewed, not applied
  });

  it("previews honestly when the version is not staged at all", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const { reporter, logs } = collect();

    await installMcp({ target, cacheDir, dryRun: true, reporter, ...registry });

    expect(logs.join("\n")).toMatch(/would fetch/);
    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });

  it("REFUSES a pin-skewed addon unless --force", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const skewed = catalog();
    skewed[1]!.pinsCore = "0.99.0"; // animation pins a core the registry does not publish
    const registry = await fakeRegistry(skewed);

    // Refused at RESOLVE now, before a single tarball moves — the old path
    // downloaded the whole set first and only then hit the install gate.
    await expect(
      installMcp({ target, cacheDir, addons: [ANIMATION], ...registry }),
    ).rejects.toThrow(/no core version has a build of every requested addon/);
    expect(registry.fetchBinary).not.toHaveBeenCalled();

    _resetPackumentCache();
    const retry = await fakeRegistry(skewed);
    await expect(
      installMcp({ target, cacheDir, addons: [ANIMATION], force: true, ...retry }),
    ).resolves.toBeUndefined();
  });
});

/**
 * The regression this whole path exists for: upstream publishes a core and
 * rebuilds the addons days later, so dist-tags.latest routinely names a version
 * no addon can run. A bare install must land on the newest core that WORKS.
 */
describe("installMcp — core is solved against the addon set", () => {
  const NEWER_CORE = "0.83.0";

  /** Core publishes a version newer than anything the addons have a build for. */
  function laggingAddonsCatalog(): FakePackage[] {
    return [
      ...catalog(),
      {
        name: CORE_PKG,
        version: NEWER_CORE, // newest → dist-tags.latest, but no addon pins it
        build: makeCoreFixture,
        dependencies: { [PPX_PKG]: "2.1.5" },
      },
    ];
  }

  it("installs the newest core the addons support, not dist-tags.latest", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(laggingAddonsCatalog());
    const { reporter, logs } = collect();

    await installMcp({ target, cacheDir, addons: [ANIMATION, PARTICLE], reporter, ...registry });

    expect(await markerVersion(project)).toBe(CORE_VER);
    expect(logs.join("\n")).toMatch(new RegExp(`${NEWER_CORE}.*newest published`));
  });

  it("still refuses a skewed core when the version is named explicitly", async () => {
    const { target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(laggingAddonsCatalog());

    // An explicit version skips the solver — so the install gate is the last line
    // of defense, and it still has to hold.
    await expect(
      installMcp({ target, cacheDir, coreVersion: NEWER_CORE, addons: [ANIMATION], ...registry }),
    ).rejects.toThrow(/pin gate FAILED/);
  });
});

describe("installMcp — offline + bundled cache", () => {
  /** A registry whose every call throws — the artist's Mac has no network at all. */
  function offlineRegistry() {
    const boom = async () => {
      throw new Error("network is down");
    };
    return { fetchImpl: vi.fn(boom), fetchBinary: vi.fn(boom) };
  }

  it("installs from a BUNDLED cache with no network (the artist-Mac path)", async () => {
    const { repo, project, target } = await makeRepo();
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-mcp-cache-"); // user cache stays EMPTY
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION, PARTICLE], { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    _resetPackumentCache();
    const offline = offlineRegistry();

    await installMcp({ target, cacheDir, coreVersion: CORE_VER, ...offline });

    expect(await exists(path.join(importRoot(project), CORE_PKG))).toBe(true);
    expect(await markerVersion(project)).toBe(CORE_VER);
    expect(await porcelain(repo)).toBe("");
    expect(offline.fetchBinary).not.toHaveBeenCalled();
  });

  it("adopts the bundle's OWN addon set instead of topping up against the default seed", async () => {
    // The bundle carries only `animation` — whatever its producer staged. The
    // default seed also wants `particlesystem`, and topping up would mean
    // fetching it: on the one machine that has no network. Adopt what shipped.
    const { project, target } = await makeRepo();
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    _resetPackumentCache();
    const offline = offlineRegistry();

    await installMcp({ target, cacheDir, coreVersion: CORE_VER, ...offline });

    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
    expect(offline.fetchImpl).not.toHaveBeenCalled();
  });

  /**
   * The tests above all name `coreVersion`, which returns before the solver ever
   * runs. These do NOT — this is the path a bare offline `scvn mcp install` takes,
   * and every regression below lived here undetected because nothing exercised it.
   */
  it("falls back to the staged version when the solver cannot reach the registry", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION, PARTICLE], { cacheDir, ...seed });

    _resetPackumentCache();
    const offline = offlineRegistry();
    const { reporter, warns } = collect();

    await installMcp({ target, cacheDir, addons: [ANIMATION, PARTICLE], reporter, ...offline });

    expect(await markerVersion(project)).toBe(CORE_VER);
    expect(warns.join("\n")).toMatch(/registry unreachable/);
    expect(offline.fetchBinary).not.toHaveBeenCalled();
  });

  /** A staged version whose addon does not pin it — what a --force fetch leaves behind. */
  async function seedSkewedCache(): Promise<string> {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const skewed = catalog();
    skewed[1]!.pinsCore = "0.99.0";
    const seed = await fakeRegistry(skewed);
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir, ...seed });
    _resetPackumentCache();
    return cacheDir;
  }

  it("refuses a skewed staged version offline, and names --force as the way through", async () => {
    const { target } = await makeRepo();
    const cacheDir = await seedSkewedCache();

    await expect(
      installMcp({ target, cacheDir, addons: [ANIMATION], ...offlineRegistry() }),
    ).rejects.toThrow(/--force/);
  });

  it("--force installs a skewed staged version offline — the escape hatch must survive", async () => {
    // The one path with no network to route around a refusal. A filter that
    // ignored --force here would make the documented escape hatch unreachable.
    const { project, target } = await makeRepo();
    const cacheDir = await seedSkewedCache();

    await installMcp({ target, cacheDir, addons: [ANIMATION], force: true, ...offlineRegistry() });

    expect(await markerVersion(project)).toBe(CORE_VER);
  });

  it("FAILS when a TYPED --addons cannot be staged — a named request is a requirement", async () => {
    const { target } = await makeRepo();
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    _resetPackumentCache();
    const offline = offlineRegistry();

    await expect(
      installMcp({
        target,
        cacheDir,
        coreVersion: CORE_VER,
        addons: [PARTICLE],
        addonsRequired: true,
        ...offline,
      }),
    ).rejects.toThrow(/network is down/);
  });

  it("DEGRADES to the cached set when a picker preference cannot be staged", async () => {
    // The artist accepts the pre-checked picker defaults on a bundle that never
    // shipped particlesystem. Failing would leave them with nothing; warn and
    // install what is actually there.
    const { project, target } = await makeRepo();
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const seed = await fakeRegistry(catalog());
    await fetchVersion(CORE_VER, [ANIMATION], { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    _resetPackumentCache();
    const offline = offlineRegistry();
    const { reporter, warns } = collect();

    await installMcp({
      target,
      cacheDir,
      coreVersion: CORE_VER,
      addons: [ANIMATION, PARTICLE], // what the picker offered, pre-checked
      addonsRequired: false,
      reporter,
      ...offline,
    });

    expect(warns.join("\n")).toMatch(/could not stage every selected addon/);
    expect(await markerPackages(project)).toEqual([CORE_PKG, ANIMATION, PPX_PKG].sort());
    expect(await exists(path.join(importRoot(project), ANIMATION))).toBe(true);
  });
});

describe("installMcp — reconcile", () => {
  it("drops a package that is no longer wanted, keeping the rest", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, addons: [ANIMATION, PARTICLE], ...registry });
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(true);

    // Re-install (fresh) with a narrower set: uninstall clears the marker first.
    await uninstallMcp({ target });
    await installMcp({ target, cacheDir, addons: [ANIMATION], ...registry });

    expect(await exists(path.join(importRoot(project), ANIMATION))).toBe(true);
    expect(await exists(path.join(importRoot(project), PARTICLE))).toBe(false);
  });
});

describe("uninstallMcp", () => {
  it("removes the vendored source and the fence, leaving git clean", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, ...registry });

    await uninstallMcp({ target });

    expect(await exists(importRoot(project))).toBe(false);
    expect(await excludeText(repo)).not.toContain("# >>> scvn mcp >>>");
    expect(await porcelain(repo)).toBe("");
  });

  it("leaves the NuGet DLLs alone by default, and purges them on request", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const nuget = path.join(project, NUGET_SUBDIR);
    await mkdir(nuget, { recursive: true });
    await writeFile(path.join(nuget, "lib.dll"), "binary");
    await installMcp({ target, cacheDir, ...registry });

    await uninstallMcp({ target });
    expect(await exists(nuget)).toBe(true);

    await uninstallMcp({ target, purgeNuget: true });
    expect(await exists(nuget)).toBe(false);
  });

  it("tolerates an absent NuGet dir under --purge-nuget", async () => {
    const { target } = await makeRepo();

    await expect(uninstallMcp({ target, purgeNuget: true })).resolves.toBeUndefined();
  });

  it("is a clean no-op when nothing is installed", async () => {
    const { repo, target } = await makeRepo();
    const { reporter, logs } = collect();

    await expect(uninstallMcp({ target, reporter })).resolves.toBeUndefined();

    expect(logs.join("\n")).toMatch(/nothing to remove/);
    expect(await porcelain(repo)).toBe("");
  });

  it("dry-run removes nothing", async () => {
    const { project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    await installMcp({ target, cacheDir, ...registry });

    await uninstallMcp({ target, dryRun: true, purgeNuget: true });

    expect(await exists(importRoot(project))).toBe(true);
  });
});

describe("fence coexistence with `scvn git --exclude`", () => {
  it("both fences survive each other, and each stays idempotent", async () => {
    const { repo, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const { setupGitexclude } = await import("../../src/features/setup/setup-gitexclude.js");

    // The exact sequence that used to destroy the MCP block.
    await installMcp({ target, cacheDir, ...registry });
    await setupGitexclude(target, {});
    await setupGitexclude(target, {});
    const text = await excludeText(repo);

    expect(text.split("# >>> scvn mcp >>>").length - 1).toBe(1);
    expect(text.split("# >>> scvn >>>").length - 1).toBe(1);
    expect(text).toContain("/Assets/UnityMCP/");
    expect(text).toContain("vFolders**");
    expect(await porcelain(repo)).toBe("");
  });

  it("uninstall strips only the mcp fence, leaving the scvn template block", async () => {
    const { repo, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const { setupGitexclude } = await import("../../src/features/setup/setup-gitexclude.js");
    await setupGitexclude(target, {});
    await installMcp({ target, cacheDir, ...registry });

    await uninstallMcp({ target });
    const text = await excludeText(repo);

    expect(text).not.toContain("# >>> scvn mcp >>>");
    expect(text).toContain("# >>> scvn >>>");
    expect(text).toContain("vFolders**");
  });

  it("migrates a repo the retired bash script wired: its fence is replaced, not duplicated", async () => {
    const { repo, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const excludeFile = (await getGitInfoExcludePath(repo))!;
    await mkdir(path.dirname(excludeFile), { recursive: true });
    await writeFile(
      excludeFile,
      "# hand-written\nbuild/\n" +
        "# >>> unity-mcp-localize >>>\n/Assets/UnityMCP/\n# <<< unity-mcp-localize <<<\n",
      "utf8",
    );

    await installMcp({ target, cacheDir, ...registry });
    const text = await excludeText(repo);

    expect(text).not.toContain("unity-mcp-localize");
    expect(text).toContain("# >>> scvn mcp >>>");
    expect(text).toContain("# hand-written\nbuild/\n"); // user lines survive
  });
});

describe("installMcp — no git repo", () => {
  it("vendors into a Unity project outside git and warns that it cannot fence", async () => {
    const dir = await tmpDir("scvn-nogit-");
    const project = path.join(dir, "game");
    await mkdir(path.join(project, "Assets"), { recursive: true });
    await mkdir(path.join(project, "Packages"), { recursive: true });
    await writeFile(path.join(project, "Packages", "manifest.json"), "{}\n");
    const target = path.join(project, "Assets");
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    const { reporter, warns } = collect();

    await installMcp({ target, cacheDir, reporter, ...registry });

    expect(await exists(path.join(importRoot(project), CORE_PKG))).toBe(true);
    expect(warns.join("\n")).toMatch(/not a git repo/);
  });

  it("REFUSES a target that is not a Unity project at all", async () => {
    const dir = await tmpDir("scvn-nogit-");
    await mkdir(path.join(dir, "Assets"), { recursive: true }); // no Packages/manifest.json
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());

    await expect(
      installMcp({ target: path.join(dir, "Assets"), cacheDir, ...registry }),
    ).rejects.toThrow(/not a Unity project/);
  });
});

describe("installMcp — .mcp.json failure is not fatal", () => {
  it("completes the vendoring when setup-mcp fails", async () => {
    const { repo, project, target } = await makeRepo();
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const registry = await fakeRegistry(catalog());
    vi.mocked(invokeSetupMcp).mockResolvedValue(false);

    await expect(installMcp({ target, cacheDir, ...registry })).resolves.toBeUndefined();

    expect(await exists(path.join(importRoot(project), CORE_PKG))).toBe(true);
    expect(await markerVersion(project)).toBe(CORE_VER);
    expect(await porcelain(repo)).toBe("");
  });
});
