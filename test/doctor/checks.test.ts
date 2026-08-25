/**
 * test/doctor/checks.test.ts — Unit tests for each individual check in doctor/checks.ts
 *
 * All external I/O is mocked so tests are deterministic and fast:
 *   - services/rsync.ts  → rsyncSupportsProgress2
 *   - util/command-exists.ts → commandExists
 *   - detectors/detect-beyond-compare.ts
 *   - detectors/detect-unity-versions.ts
 *   - detectors/detect-fork-running.ts
 *   - lib/check-mergespecfile.ts
 *   - execa (for node/git version checks)
 *
 * Each check is extracted from CHECKS by id and its run() function invoked
 * directly — no subprocess spawning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, chmod, symlink } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";

// ---------------------------------------------------------------------------
// Hoist all mocks before imports
// ---------------------------------------------------------------------------

const rsyncSupportsMock    = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
const commandExistsMock    = vi.hoisted(() => vi.fn<(bin: string) => Promise<boolean>>());
const detectBCMock         = vi.hoisted(() => vi.fn());
const detectUnityMock      = vi.hoisted(() => vi.fn());
const detectForkRunningMock = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
const checkMergespecMock   = vi.hoisted(() => vi.fn());
const execaMock            = vi.hoisted(() => vi.fn());
const installRootMock      = vi.hoisted(() => vi.fn());
const storeMetaMocks       = vi.hoisted(() => ({
  readPackagesStoreMeta:    vi.fn(),
  resolveEffectiveStoreDir: vi.fn(),
}));

vi.mock("../../src/services/rsync.js", () => ({
  rsyncSupportsProgress2: rsyncSupportsMock,
}));
vi.mock("../../src/util/command-exists.js", () => ({
  commandExists: commandExistsMock,
}));
vi.mock("../../src/detectors/detect-beyond-compare.js", () => ({
  detectBeyondCompare: detectBCMock,
}));
vi.mock("../../src/detectors/detect-unity-versions.js", () => ({
  detectUnityVersions: detectUnityMock,
}));
vi.mock("../../src/detectors/detect-fork-running.js", () => ({
  detectForkRunning: detectForkRunningMock,
}));
vi.mock("../../src/lib/check-mergespecfile.js", () => ({
  checkMergespecfile: checkMergespecMock,
}));
vi.mock("execa", () => ({ execa: execaMock }));
vi.mock("../../src/util/install-root.js", () => ({
  findInstallRoot: installRootMock,
  _resetInstallRoot: vi.fn(),
}));
const mcpCacheMocks = vi.hoisted(() => ({
  listStagedVersions: vi.fn(async () => [] as Array<{ version: string; source: string; dir: string }>),
  resolveCliForCore:  vi.fn(async () => null as { version: string; source: string; dir: string } | null),
}));

vi.mock("../../src/features/mcp/resolve-mcp-cache.js", () => mcpCacheMocks);

vi.mock("../../src/features/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/store/index.js")>();
  return {
    ...actual,
    readPackagesStoreMeta:    storeMetaMocks.readPackagesStoreMeta,
    resolveEffectiveStoreDir: storeMetaMocks.resolveEffectiveStoreDir,
  };
});

// ---------------------------------------------------------------------------
// Import under test (after mocks registered)
// ---------------------------------------------------------------------------

import { CHECKS } from "../../src/doctor/checks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCheck(id: string) {
  const check = CHECKS.find((c) => c.id === id);
  if (!check) throw new Error(`check '${id}' not found in registry`);
  return check;
}

const isDarwin = process.platform === "darwin";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CHECKS registry", () => {
  it("registers every check, by id", () => {
    expect(CHECKS.map((c) => c.id)).toEqual([
      "rsync", "git", "git-lfs", "node", "bundled-node",
      "store", "mcp-cache",
      "beyond-compare", "unity", "fork", "mergespec",
    ]);
  });

  it("all checks have id, label, and run function", () => {
    for (const c of CHECKS) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.label).toBe("string");
      expect(typeof c.run).toBe("function");
    }
  });

  it("macOnly checks are bundled-node, beyond-compare, unity, fork, mergespec", () => {
    const macOnlyIds = CHECKS.filter((c) => c.macOnly).map((c) => c.id);
    expect(macOnlyIds).toEqual(["bundled-node", "beyond-compare", "unity", "fork", "mergespec"]);
  });
});

// ---------------------------------------------------------------------------
// rsync check
// ---------------------------------------------------------------------------

describe("check: rsync", () => {
  beforeEach(() => rsyncSupportsMock.mockReset());

  it("returns pass when rsync >= 3.1", async () => {
    rsyncSupportsMock.mockResolvedValue(true);
    const result = await getCheck("rsync").run();
    expect(result.severity).toBe("pass");
  });

  it("returns warn when rsync < 3.1", async () => {
    rsyncSupportsMock.mockResolvedValue(false);
    const result = await getCheck("rsync").run();
    expect(result.severity).toBe("warn");
    expect(result.detail).toMatch(/rsync/);
  });
});

// ---------------------------------------------------------------------------
// git check
// ---------------------------------------------------------------------------

describe("check: git", () => {
  beforeEach(() => commandExistsMock.mockReset());

  it("returns pass when git is found", async () => {
    commandExistsMock.mockImplementation(async (bin: string) => bin === "git");
    const result = await getCheck("git").run();
    expect(result.severity).toBe("pass");
  });

  it("returns fail when git is missing", async () => {
    commandExistsMock.mockResolvedValue(false);
    const result = await getCheck("git").run();
    expect(result.severity).toBe("fail");
    expect(result.detail).toMatch(/git/);
  });
});

// ---------------------------------------------------------------------------
// git-lfs check — warn (not fail) when missing: only `scvn git --lfs` needs it
// ---------------------------------------------------------------------------

describe("check: git-lfs", () => {
  beforeEach(() => commandExistsMock.mockReset());

  it("returns pass when git-lfs is found (not macOnly)", async () => {
    commandExistsMock.mockImplementation(async (bin: string) => bin === "git-lfs");
    const result = await getCheck("git-lfs").run();
    expect(result.severity).toBe("pass");
    expect(getCheck("git-lfs").macOnly).toBeFalsy();
  });

  it("returns warn (never fail) when git-lfs is missing, with the brew hint", async () => {
    commandExistsMock.mockResolvedValue(false);
    const result = await getCheck("git-lfs").run();
    expect(result.severity).toBe("warn");
    expect(result.detail).toMatch(/brew install git-lfs/);
  });
});

// ---------------------------------------------------------------------------
// node check
// ---------------------------------------------------------------------------

describe("check: node", () => {
  const origVersion = process.version;
  beforeEach(() => installRootMock.mockReset());
  afterEach(() => Object.defineProperty(process, "version", { value: origVersion, configurable: true }));

  const setVersion = (v: string) =>
    Object.defineProperty(process, "version", { value: v, configurable: true });

  it("pass for Node >= 20, labeled (system) when not the bundled binary", async () => {
    setVersion("v24.16.0");
    const root = await tmpDir("scvn-ir-"); // no node/ → running node is not the bundled one
    installRootMock.mockResolvedValue(root);
    const result = await getCheck("node").run();
    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("v24.16.0");
    expect(result.detail).toContain("(system)");
  });

  it("warn for Node < 20", async () => {
    setVersion("v18.19.0");
    installRootMock.mockResolvedValue(null);
    const result = await getCheck("node").run();
    expect(result.severity).toBe("warn");
  });

  it("labeled (bundled) when the running execPath IS the bundled node", async () => {
    setVersion("v24.16.0");
    const root = await tmpDir("scvn-ir-");
    await mkdir(path.join(root, "node", "bin"), { recursive: true });
    await symlink(process.execPath, path.join(root, "node", "bin", "node")); // realpath === execPath
    installRootMock.mockResolvedValue(root);
    const result = await getCheck("node").run();
    expect(result.detail).toContain("(bundled)");
  });
});

// ---------------------------------------------------------------------------
// store check — informational, never fails
// ---------------------------------------------------------------------------

describe("check: store", () => {
  const STAGED_PACKAGES = {
    kind: "packages",
    packages: [{
      label: "vFolders", relPath: "vFolders", bytes: 1024,
      sourcePath: "/p/hub/Assets", sourceName: "hub", branch: "main",
      stagedAt: new Date().toISOString(),
    }],
  };

  beforeEach(() => {
    storeMetaMocks.readPackagesStoreMeta.mockReset().mockResolvedValue(null);
    storeMetaMocks.resolveEffectiveStoreDir.mockReset().mockResolvedValue({ storeDir: "/u/.scvn/store", source: "user" });
  });

  it("empty store → pass with 'nothing staged' hint (never a failure)", async () => {
    const result = await getCheck("store").run();
    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("nothing staged");
  });

  it("staged packages → pass with library count + size", async () => {
    storeMetaMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_PACKAGES);

    const result = await getCheck("store").run();
    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("packages: 1 staged");
    expect(result.detail).toContain("1.0 KB");
    expect(result.detail).not.toContain("(bundled)"); // user source → no label
  });

  it("bundled source → provenance line tagged (bundled)", async () => {
    storeMetaMocks.resolveEffectiveStoreDir.mockResolvedValue({ storeDir: "/cli/store", source: "bundled" });
    storeMetaMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_PACKAGES);

    const result = await getCheck("store").run();
    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("(bundled)");
  });

  it("override context → resolver gets the override; provenance line tagged (override)", async () => {
    storeMetaMocks.resolveEffectiveStoreDir.mockResolvedValue({ storeDir: "/bundle/store", source: "override" });
    storeMetaMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_PACKAGES);

    const result = await getCheck("store").run({ storeOverride: "/bundle/store" });

    expect(storeMetaMocks.resolveEffectiveStoreDir).toHaveBeenCalledWith("packages", { override: "/bundle/store" });
    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("(override)");
  });
});

// ---------------------------------------------------------------------------
// macOS-only checks — on non-darwin they all return skipped
// ---------------------------------------------------------------------------

describe("macOnly checks on non-darwin", () => {
  if (isDarwin) {
    it.skip("skipping non-darwin tests on macOS", () => {});
    return;
  }

  for (const id of ["bundled-node", "beyond-compare", "unity", "fork", "mergespec"]) {
    it(`check '${id}' returns skipped on linux`, async () => {
      const result = await getCheck(id).run();
      expect(result.severity).toBe("skipped");
      expect(result.detail).toMatch(/macOS only/);
    });
  }
});

// ---------------------------------------------------------------------------
// macOS-only checks — on darwin with mocked detectors
// ---------------------------------------------------------------------------

describe("macOnly checks on darwin", () => {
  if (!isDarwin) {
    it.skip("skipping darwin tests on non-macOS", () => {});
    return;
  }

  // bc check
  describe("check: beyond-compare", () => {
    beforeEach(() => detectBCMock.mockReset());

    it("returns pass when Beyond Compare is found", async () => {
      detectBCMock.mockResolvedValue({ found: true, path: "/Applications/Beyond Compare.app/Contents/MacOS/bcomp" });
      const result = await getCheck("beyond-compare").run();
      expect(result.severity).toBe("pass");
    });

    it("returns fail when Beyond Compare is missing", async () => {
      detectBCMock.mockResolvedValue({ found: false, path: null });
      const result = await getCheck("beyond-compare").run();
      expect(result.severity).toBe("fail");
    });
  });

  // unity check
  describe("check: unity", () => {
    beforeEach(() => detectUnityMock.mockReset());

    it("returns pass when Unity editors are found", async () => {
      detectUnityMock.mockResolvedValue([
        { version: "2022.3.15f1", editorPath: "/p", yamlMergePath: "/p/m", mergeSpecPath: "/p/s" },
      ]);
      const result = await getCheck("unity").run();
      expect(result.severity).toBe("pass");
      expect(result.detail).toContain("2022.3.15f1");
    });

    it("returns warn when no Unity editors found", async () => {
      detectUnityMock.mockResolvedValue([]);
      const result = await getCheck("unity").run();
      expect(result.severity).toBe("warn");
    });
  });

  // fork check
  describe("check: fork", () => {
    beforeEach(() => detectForkRunningMock.mockReset());

    it("returns pass when Fork is not running", async () => {
      detectForkRunningMock.mockResolvedValue(false);
      const result = await getCheck("fork").run();
      expect(result.severity).toBe("pass");
    });

    it("returns warn when Fork is running", async () => {
      detectForkRunningMock.mockResolvedValue(true);
      const result = await getCheck("fork").run();
      expect(result.severity).toBe("warn");
      expect(result.detail).toMatch(/Fork is running/);
    });
  });

  // mergespec check
  describe("check: mergespec", () => {
    beforeEach(() => {
      detectUnityMock.mockReset();
      checkMergespecMock.mockReset();
    });

    it("returns warn when no Unity editors found", async () => {
      detectUnityMock.mockResolvedValue([]);
      const result = await getCheck("mergespec").run();
      expect(result.severity).toBe("warn");
    });

    it("returns pass when mergespecfile contains BC marker", async () => {
      detectUnityMock.mockResolvedValue([
        { version: "2022.3.15f1", editorPath: "/p", yamlMergePath: "/p/m", mergeSpecPath: "/p/s/mergespecfile.txt" },
      ]);
      checkMergespecMock.mockResolvedValue({ ok: true, path: "/p/s/mergespecfile.txt" });
      const result = await getCheck("mergespec").run();
      expect(result.severity).toBe("pass");
    });

    it("returns fail when mergespecfile is missing BC marker", async () => {
      detectUnityMock.mockResolvedValue([
        { version: "2022.3.15f1", editorPath: "/p", yamlMergePath: "/p/m", mergeSpecPath: "/p/s/mergespecfile.txt" },
      ]);
      checkMergespecMock.mockResolvedValue({ ok: false, path: "/p/s/mergespecfile.txt", reason: "marker not found" });
      const result = await getCheck("mergespec").run();
      expect(result.severity).toBe("fail");
      expect(result.detail).toMatch(/marker not found/);
    });
  });

  // bundled-node check (RT#11 diagnostic)
  describe("check: bundled-node", () => {
    beforeEach(() => {
      installRootMock.mockReset();
      execaMock.mockReset();
    });

    async function bundleRootWithNode(): Promise<string> {
      const root = await tmpDir("scvn-ir-");
      await mkdir(path.join(root, "node", "bin"), { recursive: true });
      await writeFile(path.join(root, "node", "bin", "node"), "x");
      await chmod(path.join(root, "node", "bin", "node"), 0o755);
      return root;
    }

    it("absent bundled node → skipped (a dev checkout)", async () => {
      installRootMock.mockResolvedValue(await tmpDir("scvn-ir-")); // no node/ dir
      const result = await getCheck("bundled-node").run();
      expect(result.severity).toBe("skipped");
    });

    it("present but unrunnable → warn with the xattr hint", async () => {
      installRootMock.mockResolvedValue(await bundleRootWithNode());
      execaMock.mockRejectedValue(new Error("Bad CPU type in executable"));
      const result = await getCheck("bundled-node").run();
      expect(result.severity).toBe("warn");
      expect(result.detail).toMatch(/xattr/);
    });

    it("present + runnable (system node in use) → pass", async () => {
      installRootMock.mockResolvedValue(await bundleRootWithNode());
      execaMock.mockResolvedValue({ stdout: "v24.16.0" });
      const result = await getCheck("bundled-node").run();
      expect(result.severity).toBe("pass");
    });
  });
});

// ---------------------------------------------------------------------------
// mcp-cache check — informational: an empty cache is a normal fresh-machine
// state, so the worst it reports is a warn. It never fails the run.
// ---------------------------------------------------------------------------

describe("check: mcp-cache", () => {
  it("nothing staged → warn, never fail", async () => {
    mcpCacheMocks.listStagedVersions.mockResolvedValue([]);

    const result = await getCheck("mcp-cache").run();

    expect(result.severity).toBe("warn");
    expect(result.detail).toContain("nothing staged");
  });

  it("staged + cli cached → pass, newest first", async () => {
    mcpCacheMocks.listStagedVersions.mockResolvedValue([
      { version: "0.82.10", source: "user", dir: "/u/mcp/a" },
      { version: "0.82.3", source: "user", dir: "/u/mcp/b" },
    ]);
    mcpCacheMocks.resolveCliForCore.mockResolvedValue({
      version: "0.82.10", source: "user", dir: "/u/cli",
    });

    const result = await getCheck("mcp-cache").run();

    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("V0.82.10, V0.82.3");
    expect(result.detail).toContain("unity-mcp-cli@0.82.10");
    expect(result.detail).not.toContain("(bundled)");
  });

  it("labels a bundled cache", async () => {
    mcpCacheMocks.listStagedVersions.mockResolvedValue([
      { version: "1.0.0", source: "bundled", dir: "/b/mcp/a" },
    ]);
    mcpCacheMocks.resolveCliForCore.mockResolvedValue({
      version: "1.0.0", source: "bundled", dir: "/b/cli",
    });

    const result = await getCheck("mcp-cache").run();

    expect(result.severity).toBe("pass");
    expect(result.detail).toContain("(bundled)");
  });

  it("warns when the source is staged but no cli is cached", async () => {
    // Vendoring would still work; .mcp.json could not be written — and on an
    // offline machine there is no way to fetch the cli afterwards.
    mcpCacheMocks.listStagedVersions.mockResolvedValue([
      { version: "1.0.0", source: "user", dir: "/u/mcp/a" },
    ]);
    mcpCacheMocks.resolveCliForCore.mockResolvedValue(null);

    const result = await getCheck("mcp-cache").run();

    expect(result.severity).toBe("warn");
    expect(result.detail).toContain("no unity-mcp-cli cached");
  });
});
