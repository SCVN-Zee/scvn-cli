/**
 * test/commands/packages.test.ts — Flow-level tests for commands/packages.ts
 *
 * fakePrompt scripts TTY interactions; feature handlers + store meta reader
 * are mocked at command seams. The packages-specific contracts: add resolves a
 * picked folder to its project-root-relative package (rejecting folders
 * outside a Unity project and Unity's special top-level dirs picked whole),
 * import staged-package multiselect defaulting to ALL + subset apply, remove
 * opt-in per package.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakePrompt } from "../../src/ui/prompt.js";
import type { FakeCall } from "../../src/ui/prompt.js";

let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;

beforeEach(() => {
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const discoverMock = vi.hoisted(() => ({
  discoverUnityProjects: vi.fn(),
}));

const historyMocks = vi.hoisted(() => ({
  getLastProjectsByRole: vi.fn(),
  appendHistory:         vi.fn(),
}));

const loadConfigMock = vi.hoisted(() => ({
  loadConfig: vi.fn(),
}));

const fsPredicateMocks = vi.hoisted(() => ({
  exists: vi.fn(),
  isFile: vi.fn(),
  isDir:  vi.fn(),
}));

const packagesFeatureMocks = vi.hoisted(() => ({
  exportPackages: vi.fn(),
  importPackages: vi.fn(),
  removePackages: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  readPackagesStoreMeta:    vi.fn(),
  resolveEffectiveStoreDir: vi.fn(),
}));

vi.mock("../../src/services/discover.js",   () => discoverMock);
vi.mock("../../src/util/history.js",         () => historyMocks);
vi.mock("../../src/config/load.js",          () => loadConfigMock);
vi.mock("../../src/util/fs-predicates.js",   () => fsPredicateMocks);

// resolveAddFolder is the REAL implementation — only the byte-copying feature
// handlers are stubbed, so the folder→spec resolution (marker walk-up +
// root-relative identity) is under test. Its only I/O is the fs-predicates
// isFile seam, mocked below to a fixed set of project roots.
vi.mock("../../src/features/packages/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/packages/index.js")>();
  return {
    ...actual,
    exportPackages: packagesFeatureMocks.exportPackages,
    importPackages: packagesFeatureMocks.importPackages,
    removePackages: packagesFeatureMocks.removePackages,
  };
});

vi.mock("../../src/features/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/features/store/index.js")>();
  return {
    ...actual,
    readPackagesStoreMeta:    storeMocks.readPackagesStoreMeta,
    resolveEffectiveStoreDir: storeMocks.resolveEffectiveStoreDir,
  };
});

import { runPackages } from "../../src/commands/packages.js";

// Default effective store = user store; the meta-reader mock drives the gate.
const USER_STORE_ROOT = "/home/.scvn/store";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HUB        = "/projects/hub";
const GAME_A     = "/projects/game-a";
const GAME_B     = "/projects/game-b";
const HUB_ASSETS = `${HUB}/Assets`;

const FAKE_PROJECTS = [
  { path: `${HUB}/Assets`,    projectRoot: HUB,    name: "hub",    scene: "main", branch: "main", mtimeMs: Date.now() - 60_000 },
  { path: `${GAME_A}/Assets`, projectRoot: GAME_A, name: "game-a", scene: "main", branch: "dev",  mtimeMs: Date.now() - 120_000 },
];

const STAGED_AT = new Date(Date.now() - 3_600_000).toISOString();
const STAGED_META = {
  kind: "packages" as const,
  version: 2,
  packages: [
    { label: "vFolders",       relPath: "Assets/vFolders",        bytes: 1,
      sourcePath: HUB, sourceName: "hub", branch: "main", stagedAt: STAGED_AT },
    { label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 1,
      sourcePath: HUB, sourceName: "hub", branch: "main", stagedAt: STAGED_AT },
  ],
};

function resetMocks() {
  discoverMock.discoverUnityProjects.mockResolvedValue(FAKE_PROJECTS);
  historyMocks.getLastProjectsByRole.mockResolvedValue({ src: null, target: null });
  historyMocks.appendHistory.mockResolvedValue(undefined);
  loadConfigMock.loadConfig.mockResolvedValue({ projectsRoot: "/fake/projects" });
  fsPredicateMocks.exists.mockResolvedValue(true);
  fsPredicateMocks.isDir.mockResolvedValue(true);
  // The Unity-project marker: only the fixture roots are projects.
  fsPredicateMocks.isFile.mockImplementation(async (p: string) =>
    p === `${HUB}/ProjectSettings/ProjectVersion.txt` ||
    p === `${GAME_A}/ProjectSettings/ProjectVersion.txt` ||
    p === `${GAME_B}/ProjectSettings/ProjectVersion.txt`);
  packagesFeatureMocks.exportPackages.mockResolvedValue(undefined);
  packagesFeatureMocks.importPackages.mockResolvedValue(undefined);
  packagesFeatureMocks.removePackages.mockResolvedValue(undefined);
  storeMocks.readPackagesStoreMeta.mockResolvedValue(null);
  storeMocks.resolveEffectiveStoreDir.mockResolvedValue({ storeDir: USER_STORE_ROOT, source: "user" });
}

function interactiveCalls(prompt: { calls: FakeCall[] }) {
  return prompt.calls.filter(
    (c) => c.type === "select" || c.type === "multiselect" ||
           c.type === "confirm" || c.type === "text"
  );
}

describe("runPackages()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // add
  // -------------------------------------------------------------------------

  it("add: stages a picked Assets folder with its root-relative identity", async () => {
    const prompt = fakePrompt([]);

    await runPackages({ verb: "add", from: `${HUB_ASSETS}/Plugins/Sirenix` }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0); // --from → no dir prompt
    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      HUB,
      [{ label: "Sirenix", relPath: "Assets/Plugins/Sirenix" }],
      expect.objectContaining({ dryRun: false }),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "add", src: HUB, step: "packages" }),
    );
  });

  it("add: stages a root-level folder outside Assets (embedded UPM package)", async () => {
    await runPackages({ verb: "add", from: `${GAME_B}/Packages/com.acme.core` }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      GAME_B,
      [{ label: "com.acme.core", relPath: "Packages/com.acme.core" }],
      expect.objectContaining({ dryRun: false }),
    );
  });

  it("add: stages a custom root-level folder", async () => {
    await runPackages({ verb: "add", from: `${GAME_B}/SharedTools` }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      GAME_B,
      [{ label: "SharedTools", relPath: "SharedTools" }],
      expect.anything(),
    );
  });

  it("export is a back-compat alias for add", async () => {
    await runPackages({ verb: "export", from: `${HUB_ASSETS}/vFolders` }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      HUB,
      [{ label: "vFolders", relPath: "Assets/vFolders" }],
      expect.anything(),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "add", src: HUB, step: "packages" }),
    );
  });

  it("add: multiple --from folders under one project stage in a single run", async () => {
    const prompt = fakePrompt([]);

    await runPackages(
      { verb: "add", from: [`${HUB_ASSETS}/Plugins/Sirenix`, `${HUB_ASSETS}/vFolders`] },
      prompt,
    );

    expect(interactiveCalls(prompt)).toHaveLength(0); // --from → no dir prompt
    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledTimes(1);
    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      HUB,
      [
        { label: "Sirenix", relPath: "Assets/Plugins/Sirenix" },
        { label: "vFolders", relPath: "Assets/vFolders" },
      ],
      expect.objectContaining({ dryRun: false }),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledTimes(1);
    expect(historyMocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "add", src: HUB, step: "packages" }),
    );
  });

  it("add: picks spanning projects group per project root (a stage call each)", async () => {
    await runPackages(
      { verb: "add", from: [`${HUB_ASSETS}/vFolders`, `${GAME_B}/Assets/Plugins/Sirenix`] },
      fakePrompt([]),
    );

    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledTimes(2);
    expect(packagesFeatureMocks.exportPackages).toHaveBeenNthCalledWith(
      1,
      HUB,
      [{ label: "vFolders", relPath: "Assets/vFolders" }],
      expect.anything(),
    );
    expect(packagesFeatureMocks.exportPackages).toHaveBeenNthCalledWith(
      2,
      GAME_B,
      [{ label: "Sirenix", relPath: "Assets/Plugins/Sirenix" }],
      expect.anything(),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledTimes(2);
  });

  it("add: any invalid pick stages nothing (all-or-nothing, exit 1)", async () => {
    await runPackages(
      { verb: "add", from: [`${HUB_ASSETS}/vFolders`, "/tmp/loose-folder"] },
      fakePrompt([]),
    );

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(historyMocks.appendHistory).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: with no --from, prompts for a folder then stages it", async () => {
    const prompt = fakePrompt([`${HUB_ASSETS}/vFolders`]);

    await runPackages({ verb: "add" }, prompt);

    const dirPrompt = prompt.calls.find((c) => c.type === "text");
    expect(dirPrompt?.type === "text" && dirPrompt.kind).toBe("dir");
    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      HUB,
      [{ label: "vFolders", relPath: "Assets/vFolders" }],
      expect.anything(),
    );
  });

  it("add: a folder outside any Unity project is rejected (exit 1, no stage)", async () => {
    await runPackages({ verb: "add", from: "/tmp/loose-folder" }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(historyMocks.appendHistory).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: the Assets/ dir itself is rejected — a subfolder is required (exit 1)", async () => {
    await runPackages({ verb: "add", from: HUB_ASSETS }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: the Packages/ dir as a whole is rejected — a specific package is required (exit 1)", async () => {
    await runPackages({ verb: "add", from: `${GAME_B}/Packages` }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: the project root itself is rejected (exit 1)", async () => {
    await runPackages({ verb: "add", from: GAME_B }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: a nonexistent picked folder is rejected before any stage (exit 1)", async () => {
    // Path shape WOULD resolve to a valid package (Plugins/Sirenix under
    // Assets/), but the folder does not exist — the existence guard must reject
    // it up front rather than confirm a 0 B add and fail mid-rsync.
    fsPredicateMocks.isDir.mockResolvedValue(false);

    await runPackages({ verb: "add", from: `${HUB_ASSETS}/Plugins/Sirenix` }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).not.toHaveBeenCalled();
    expect(historyMocks.appendHistory).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("add: threads --store override to the feature as storeDir", async () => {
    await runPackages({ verb: "add", from: `${HUB_ASSETS}/vFolders`, store: "/bundle/store" }, fakePrompt([]));

    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledWith(
      HUB,
      [{ label: "vFolders", relPath: "Assets/vFolders" }],
      expect.objectContaining({ storeDir: "/bundle/store" }),
    );
  });

  // -------------------------------------------------------------------------
  // import
  // -------------------------------------------------------------------------

  it("import: staged multiselect defaults to ALL staged; single-select target; subset applies only selected entries", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([["Assets/vFolders"], GAME_A, true]);

    await runPackages({ verb: "import" }, prompt);

    const stagedMs  = prompt.calls.find((c) => c.type === "multiselect");
    const targetSel = prompt.calls.find((c) => c.type === "select");
    if (stagedMs?.type !== "multiselect") throw new Error("expected staged multiselect");
    if (targetSel?.type !== "select")     throw new Error("expected target select");
    expect(stagedMs.initialValues).toEqual(["Assets/vFolders", "Assets/Plugins/Sirenix"]); // default all
    expect(targetSel.options?.map((o) => o.value)).toEqual([GAME_A]);       // source filtered, root values

    expect(packagesFeatureMocks.importPackages).toHaveBeenCalledWith(
      GAME_A,
      [STAGED_META.packages[0]], // only vFolders entry
      expect.anything(),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "import", src: HUB, target: GAME_A, step: "packages" }),
    );
  });

  it("import reads provenance + applies from the bundled store when resolver falls back", async () => {
    const BUNDLED = "/cli/store";
    storeMocks.resolveEffectiveStoreDir.mockResolvedValue({ storeDir: BUNDLED, source: "bundled" });
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([["Assets/vFolders"], GAME_A, true]);

    await runPackages({ verb: "import" }, prompt);

    expect(storeMocks.readPackagesStoreMeta).toHaveBeenCalledWith(BUNDLED);
    expect(packagesFeatureMocks.importPackages).toHaveBeenCalledWith(
      GAME_A,
      [STAGED_META.packages[0]],
      expect.objectContaining({ storeDir: BUNDLED }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("import: --store override forwarded to resolveEffectiveStoreDir and the handler", async () => {
    const OVERRIDE = "/bundle/store";
    storeMocks.resolveEffectiveStoreDir.mockResolvedValue({ storeDir: OVERRIDE, source: "override" });
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([["Assets/vFolders"], GAME_A, true]);

    await runPackages({ verb: "import", store: OVERRIDE }, prompt);

    expect(storeMocks.resolveEffectiveStoreDir).toHaveBeenCalledWith("packages", { override: OVERRIDE });
    expect(storeMocks.readPackagesStoreMeta).toHaveBeenCalledWith(OVERRIDE);
    expect(packagesFeatureMocks.importPackages).toHaveBeenCalledWith(
      GAME_A,
      [STAGED_META.packages[0]],
      expect.objectContaining({ storeDir: OVERRIDE }),
    );
  });

  it("import with empty store: exit 1, no prompts, no apply", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(null);
    const prompt = fakePrompt([]);

    await runPackages({ verb: "import" }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(packagesFeatureMocks.importPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("import -y with --to: promptless, ALL staged applied per target", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([]);

    await runPackages({ verb: "import", autoYes: true, to: [GAME_A] }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(packagesFeatureMocks.importPackages).toHaveBeenCalledWith(
      GAME_A,
      STAGED_META.packages,
      expect.anything(),
    );
  });

  it("import -y with --to pointing at an Assets dir resolves to the project root", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);

    await runPackages({ verb: "import", autoYes: true, to: [`${GAME_A}/Assets`] }, fakePrompt([]));

    expect(packagesFeatureMocks.importPackages).toHaveBeenCalledWith(
      GAME_A,
      STAGED_META.packages,
      expect.anything(),
    );
  });

  it("import -y with --to outside any Unity project: usage error, exit 1", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);

    await runPackages({ verb: "import", autoYes: true, to: ["/tmp/loose-folder"] }, fakePrompt([]));

    expect(packagesFeatureMocks.importPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("import -y without --to: usage error, exit 1", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);

    await runPackages({ verb: "import", autoYes: true }, fakePrompt([]));

    expect(packagesFeatureMocks.importPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("import -y with 2+ --to: usage error, exit 1, no apply (single-target)", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);

    await runPackages({ verb: "import", autoYes: true, to: [GAME_A, GAME_B] }, fakePrompt([]));

    expect(packagesFeatureMocks.importPackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("bare packages (no verb): fires the verb select menu", async () => {
    const prompt = fakePrompt(["add"]);

    await runPackages({ from: `${HUB_ASSETS}/vFolders` }, prompt);

    const verbSelect = prompt.calls.find(
      (c) => c.type === "select" && c.message.includes("which operation")
    );
    expect(verbSelect).toBeDefined();
    expect(packagesFeatureMocks.exportPackages).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // remove
  // -------------------------------------------------------------------------

  it("remove: multiselect (nothing preselected); feature gets chosen relPaths", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([["Assets/Plugins/Sirenix"]]);

    await runPackages({ verb: "remove" }, prompt);

    const ms = prompt.calls.find((c) => c.type === "multiselect");
    if (ms?.type !== "multiselect") throw new Error("expected multiselect");
    expect(ms.initialValues).toEqual([]); // opt-in each removal

    expect(packagesFeatureMocks.removePackages).toHaveBeenCalledWith(
      ["Assets/Plugins/Sirenix"],
      expect.objectContaining({ storeDir: USER_STORE_ROOT }),
    );
    expect(historyMocks.appendHistory).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "remove", step: "packages" }),
    );
  });

  it("remove: nothing staged → exit 1, feature not called", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(null);

    await runPackages({ verb: "remove" }, fakePrompt([]));

    expect(packagesFeatureMocks.removePackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("remove -y without --packages: usage error, exit 1, no removal", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);

    await runPackages({ verb: "remove", autoYes: true }, fakePrompt([]));

    expect(packagesFeatureMocks.removePackages).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("remove -y with --packages: promptless, feature gets relPaths", async () => {
    storeMocks.readPackagesStoreMeta.mockResolvedValue(STAGED_META);
    const prompt = fakePrompt([]);

    await runPackages({ verb: "remove", autoYes: true, packages: ["Assets/vFolders"] }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(packagesFeatureMocks.removePackages).toHaveBeenCalledWith(
      ["Assets/vFolders"],
      expect.anything(),
    );
  });
});
