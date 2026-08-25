/**
 * test/scripts/pack.test.ts — Flow-level tests for scripts/pack.ts (the maintainer pack runner).
 *
 * runPackBundle() returns an exit code (0 ok, 1 failed) and is non-interactive, so there are no
 * prompt/confirm/dry-run cases. Feature/service seams (resolveBundleSourcePaths, assembleBundle,
 * createZip, getVersion, store meta, node-dist) are mocked; fs (mkdtemp/rm/access) runs for real on
 * tmp dirs so cleanup + the build guard are exercised genuinely.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";

let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;

beforeEach(() => {
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const bundlePathsMock = vi.hoisted(() => ({ resolveBundleSourcePaths: vi.fn() }));
const assembleMock    = vi.hoisted(() => ({ assembleBundle: vi.fn() }));
const zipMock         = vi.hoisted(() => ({ createZip: vi.fn() }));
const appInfoMock     = vi.hoisted(() => ({ getVersion: vi.fn() }));
const storeMocks      = vi.hoisted(() => ({
  readPackagesStoreMeta: vi.fn(),
}));
const nodeDistMock    = vi.hoisted(() => ({
  fetchNodeBinary:     vi.fn(),
  currentDarwinArch:   vi.fn(),
  PINNED_NODE_VERSION: "24.16.0",
}));

vi.mock("../../src/features/pack/bundle-paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/pack/bundle-paths.js")>();
  return { ...actual, resolveBundleSourcePaths: bundlePathsMock.resolveBundleSourcePaths };
});
vi.mock("../../src/features/pack/assemble-bundle.js", () => assembleMock);
vi.mock("../../src/services/zip.js", () => zipMock);
vi.mock("../../src/util/app-info.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/app-info.js")>();
  return { ...actual, getVersion: appInfoMock.getVersion };
});
vi.mock("../../src/features/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/store/index.js")>();
  return {
    ...actual,
    readPackagesStoreMeta: storeMocks.readPackagesStoreMeta,
  };
});
vi.mock("../../src/services/node-dist.js", () => nodeDistMock);

import { runPackBundle } from "../../scripts/pack.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PACKAGES_META = {
  kind: "packages" as const, sourcePath: "/p/hub/Assets", sourceName: "hub",
  branch: "main", exportedAt: new Date(Date.now() - 3_600_000).toISOString(), bytes: 2,
  packages: [{ label: "vFolders", relPath: "vFolders", bytes: 1 }],
};

/** Build a paths object rooted under a tmp dir; optionally create dist/cli.mjs. */
async function makePaths(installRoot: string, withBuild: boolean) {
  const scvnParent = path.join(installRoot, "home", ".scvn");
  if (withBuild) {
    await mkdir(path.join(installRoot, "dist"), { recursive: true });
    await writeFile(path.join(installRoot, "dist", "cli.mjs"), "// built", "utf8");
  }
  return {
    installRoot,
    cliEntry:        path.join(installRoot, "dist", "cli.mjs"),
    userStoreParent: scvnParent,
    userStoreDir:    path.join(scvnParent, "store"),
    nodeCacheDir:    path.join(scvnParent, "cache", "node"),
    outDir:          path.join(installRoot, "pkg"),
  };
}

let fakeNodeBin: string;

beforeEach(async () => {
  vi.clearAllMocks();
  appInfoMock.getVersion.mockReturnValue("9.9.9");
  storeMocks.readPackagesStoreMeta.mockResolvedValue(PACKAGES_META);
  assembleMock.assembleBundle.mockResolvedValue(undefined);
  zipMock.createZip.mockResolvedValue(undefined);
  // node-dist is mocked; fetchNodeBinary resolves a REAL temp file so the preview can stat its size.
  nodeDistMock.currentDarwinArch.mockReturnValue("arm64");
  const holder = await tmpDir("scvn-fakenode-");
  fakeNodeBin = path.join(holder, "node");
  await writeFile(fakeNodeBin, "x".repeat(123), "utf8");
  nodeDistMock.fetchNodeBinary.mockResolvedValue(fakeNodeBin);
});

describe("runPackBundle()", () => {
  it("missing dist/cli.mjs → returns 1 with build hint, no assemble/zip", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, false));

    const code = await runPackBundle();

    expect(code).toBe(1);
    expect(assembleMock.assembleBundle).not.toHaveBeenCalled();
    expect(zipMock.createZip).not.toHaveBeenCalled();
  });

  it("happy path: fetches Node, assembles, zips a version-stamped archive, cleans staging", async () => {
    const root = await tmpDir("scvn-pack-root-");
    const p = await makePaths(root, true);
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(p);
    let staging: string | undefined;
    assembleMock.assembleBundle.mockImplementation(async (o: { stagingDir: string }) => { staging = o.stagingDir; });

    const code = await runPackBundle();

    expect(code).toBe(0);
    expect(nodeDistMock.fetchNodeBinary).toHaveBeenCalledWith(
      expect.objectContaining({ version: "24.16.0", arch: "arm64", cacheDir: p.nodeCacheDir }),
    );
    expect(assembleMock.assembleBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        installRoot:     root,
        userStoreParent: p.userStoreParent,
        version:         "9.9.9",
        nodeBinPath:     fakeNodeBin,
      }),
    );
    const archive = path.join(root, "pkg", "scvn-bundle-9.9.9.zip");
    expect(zipMock.createZip).toHaveBeenCalledWith(staging, archive);
    expect(staging).toBeDefined();
    await expect(access(staging!)).rejects.toThrow(); // temp staging removed
  });

  it("assemble failure: returns 1, no zip, staging still cleaned", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, true));
    let staging: string | undefined;
    assembleMock.assembleBundle.mockImplementation(async (o: { stagingDir: string }) => {
      staging = o.stagingDir;
      throw new Error("disk full");
    });

    const code = await runPackBundle();

    expect(code).toBe(1);
    expect(zipMock.createZip).not.toHaveBeenCalled();
    expect(staging).toBeDefined();
    await expect(access(staging!)).rejects.toThrow();
  });

  it("empty store: warns but still bundles the CLI", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, true));
    storeMocks.readPackagesStoreMeta.mockResolvedValue(null);

    const code = await runPackBundle();

    expect(code).toBe(0);
    expect(assembleMock.assembleBundle).toHaveBeenCalledOnce();
  });

  it("noNode: skips the Node fetch, assembles without nodeBinPath", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, true));

    const code = await runPackBundle({ noNode: true });

    expect(code).toBe(0);
    expect(nodeDistMock.fetchNodeBinary).not.toHaveBeenCalled();
    expect(assembleMock.assembleBundle).toHaveBeenCalledWith(
      expect.objectContaining({ nodeBinPath: undefined }),
    );
  });

  it("Node fetch failure: returns 1 BEFORE staging — no assemble, no zip", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, true));
    nodeDistMock.fetchNodeBinary.mockRejectedValueOnce(new Error("offline"));

    const code = await runPackBundle();

    expect(code).toBe(1);
    expect(assembleMock.assembleBundle).not.toHaveBeenCalled();
    expect(zipMock.createZip).not.toHaveBeenCalled();
  });

  it("unsupported CPU (currentDarwinArch throws) without noNode: returns 1 before any fetch/assemble", async () => {
    const root = await tmpDir("scvn-pack-root-");
    bundlePathsMock.resolveBundleSourcePaths.mockResolvedValue(await makePaths(root, true));
    nodeDistMock.currentDarwinArch.mockImplementation(() => { throw new Error("unsupported arch: ppc64"); });

    const code = await runPackBundle();

    expect(code).toBe(1);
    expect(nodeDistMock.fetchNodeBinary).not.toHaveBeenCalled();
    expect(assembleMock.assembleBundle).not.toHaveBeenCalled();
  });
});
