/**
 * test/commands/setup.test.ts — Flow-level tests for commands/setup.ts
 * (runSetupOp, the v0.3 direct-command runner).
 *
 * Uses fakePrompt to script all TTY interactions. Locked contract:
 *   - op is REQUIRED — no operation menu exists anywhere in the flow
 *   - target resolution: args.target (flag) → SCVN_TARGET env → interactive
 *   - --yes requires an explicit target — exitCode 1, handler NOT called,
 *     message names --target (auto-pick of first project is gone)
 *   - each op dispatches its matching handler with dryRun/autoYes through
 *   - ignore-dirty keeps the multiselect submodule-picker seam
 *
 * All real I/O (git, fs, discover) is mocked so tests run without filesystem access.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakePrompt } from "../../src/ui/prompt.js";
import type { FakeCall } from "../../src/ui/prompt.js";

/** Interactive prompt calls only — spinner events are recorded too but are not TTY questions. */
function interactiveCalls(prompt: { calls: FakeCall[] }): FakeCall[] {
  const kinds = new Set(["select", "multiselect", "confirm", "text"]);
  return prompt.calls.filter((c) => kinds.has(c.type));
}

// ---------------------------------------------------------------------------
// Capture clack output (stdout + stderr) so message contracts are assertable
// ---------------------------------------------------------------------------

let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;
let output: string[] = [];

beforeEach(() => {
  output = [];
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => { output.push(String(chunk)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => { output.push(String(chunk)); return true; }) as typeof process.stderr.write;
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

const handlerMocks = vi.hoisted(() => ({
  setupTemplate:          vi.fn(),
  setupTemplates:         vi.fn(),
  pruneNestedGitignores:  vi.fn(),
  toggleSubmoduleIgnore:  vi.fn(),
}));

// ---------------------------------------------------------------------------
// vi.mock registrations
// ---------------------------------------------------------------------------

vi.mock("../../src/services/discover.js", () => discoverMock);

vi.mock("../../src/features/setup/setup-templates.js", () => ({
  setupTemplate:  handlerMocks.setupTemplate,
  setupTemplates: handlerMocks.setupTemplates,
}));
vi.mock("../../src/features/setup/prune-nested-gitignores.js", () => ({
  pruneNestedGitignores: handlerMocks.pruneNestedGitignores,
}));
vi.mock("../../src/features/setup/toggle-submodule-ignore.js", () => ({
  toggleSubmoduleIgnore: handlerMocks.toggleSubmoduleIgnore,
}));

import { runSetupOp } from "../../src/commands/setup.js";

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const FAKE_PROJECTS = [
  {
    path:    "/projects/luna/Assets",
    name:    "luna",
    scene:   "main",
    branch:  "main",
    mtimeMs: Date.now() - 60_000,
  },
  {
    path:    "/projects/orbit/Assets",
    name:    "orbit",
    scene:   "main",
    branch:  "dev",
    mtimeMs: Date.now() - 3_600_000,
  },
];

function resetMocks() {
  discoverMock.discoverUnityProjects.mockResolvedValue(FAKE_PROJECTS);
  handlerMocks.setupTemplate.mockResolvedValue(undefined);
  handlerMocks.setupTemplates.mockResolvedValue(undefined);
  handlerMocks.pruneNestedGitignores.mockResolvedValue(undefined);
  handlerMocks.toggleSubmoduleIgnore.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run fn with SCVN_TARGET env preset, cleaned up after. */
function withTargetPreset(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const prev = process.env["SCVN_TARGET"];
    process.env["SCVN_TARGET"] = "/projects/luna/Assets";
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env["SCVN_TARGET"];
      else process.env["SCVN_TARGET"] = prev;
    }
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runSetupOp()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["SCVN_TARGET"];
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Target resolution: flag → env → interactive
  // -------------------------------------------------------------------------

  it("--target flag skips select prompt and reaches the handler", async () => {
    const prompt = fakePrompt([]); // no prompts expected
    await runSetupOp("ignore-dirty", { target: "/projects/orbit/Assets" }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledOnce();
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
      "/projects/orbit/Assets",
      expect.any(Object)
    );
  });

  it("SCVN_TARGET env honored when flag absent",
    withTargetPreset(async () => {
      await runSetupOp("ignore-dirty", {}, fakePrompt([]));
      expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
        "/projects/luna/Assets",
        expect.any(Object)
      );
    })
  );

  it("--target flag beats SCVN_TARGET env",
    withTargetPreset(async () => {
      await runSetupOp("ignore-dirty", { target: "/projects/orbit/Assets" }, fakePrompt([]));
      expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
        "/projects/orbit/Assets",
        expect.any(Object)
      );
    })
  );

  it("no flag/env: fires select prompt for target project — and never an op menu", async () => {
    const prompt = fakePrompt([
      "/projects/luna/Assets", // target select
    ]);
    await runSetupOp("ignore-dirty", {}, prompt);

    const selects = prompt.calls.filter(
      (c) => c.type === "select" && c.message.toLowerCase().includes("target")
    );
    expect(selects).toHaveLength(1);

    // v0.3 pin: the "Which setup operation?" menu no longer exists
    const opMenus = prompt.calls.filter(
      (c) => c.type === "select" && c.message.toLowerCase().includes("operation")
    );
    expect(opMenus).toHaveLength(0);
  });

  it("empty-string --target falls through to the picker (never targets cwd)", async () => {
    const prompt = fakePrompt(["/projects/luna/Assets"]);
    await runSetupOp("ignore-dirty", { target: "" }, prompt);

    expect(prompt.calls.some((c) => c.type === "select")).toBe(true);
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
      "/projects/luna/Assets",
      expect.any(Object)
    );
  });

  it("empty-string SCVN_TARGET env falls through to the picker", async () => {
    const prev = process.env["SCVN_TARGET"];
    process.env["SCVN_TARGET"] = "";
    try {
      const prompt = fakePrompt(["/projects/luna/Assets"]);
      await runSetupOp("ignore-dirty", {}, prompt);

      expect(prompt.calls.some((c) => c.type === "select")).toBe(true);
      expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
        "/projects/luna/Assets",
        expect.any(Object)
      );
    } finally {
      if (prev === undefined) delete process.env["SCVN_TARGET"];
      else process.env["SCVN_TARGET"] = prev;
    }
  });

  it("-y with empty-string target: guard fires, handler NOT called", async () => {
    await runSetupOp("ignore-dirty", { target: "", autoYes: true }, fakePrompt([]));

    expect(process.exitCode).toBe(1);
    expect(handlerMocks.toggleSubmoduleIgnore).not.toHaveBeenCalled();
  });

  it("zero discovered projects: falls back to text prompt", async () => {
    discoverMock.discoverUnityProjects.mockResolvedValue([]);
    const prompt = fakePrompt(["/manual/Game/Assets"]);

    await runSetupOp("ignore-dirty", {}, prompt);

    expect(prompt.calls.some((c) => c.type === "text")).toBe(true);
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
      "/manual/Game/Assets",
      expect.any(Object)
    );
  });

  // -------------------------------------------------------------------------
  // --yes safety: explicit target required, never auto-pick
  // -------------------------------------------------------------------------

  it("-y without target/env: exitCode 1, handler NOT called, message names --target", async () => {
    const prompt = fakePrompt([]); // zero prompts — must fail before any TTY use

    await runSetupOp("ignore-dirty", { autoYes: true }, prompt);

    expect(process.exitCode).toBe(1);
    expect(handlerMocks.toggleSubmoduleIgnore).not.toHaveBeenCalled();
    expect(prompt.calls).toHaveLength(0);
    expect(output.join("")).toContain("--target");
  });

  it("-y with --target: zero prompts, dryRun/autoYes pass through", async () => {
    const prompt = fakePrompt([]);

    await runSetupOp("ignore-dirty", {
      target:  "/projects/luna/Assets",
      autoYes: true,
      dryRun:  true,
    }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledOnce();
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
      "/projects/luna/Assets",
      expect.objectContaining({ dryRun: true })
    );
  });

  // -------------------------------------------------------------------------
  // Op dispatch
  // -------------------------------------------------------------------------

  it("op ignore-dirty: calls toggleSubmoduleIgnore", async () => {
    await runSetupOp("ignore-dirty", { target: "/projects/luna/Assets" }, fakePrompt([]));
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledOnce();
    expect(handlerMocks.toggleSubmoduleIgnore).toHaveBeenCalledWith(
      "/projects/luna/Assets",
      expect.any(Object)
    );
  });

  // -------------------------------------------------------------------------
  // ignore-dirty submodule multiselect seam
  // -------------------------------------------------------------------------

  it("ignore-dirty interactive: multiselect drives the submodule picker", async () => {
    let picked: Set<string> | undefined;
    handlerMocks.toggleSubmoduleIgnore.mockImplementation(
      async (_t: string, opts: { confirm?: (title: string, items: Array<{ label: string; preselected: boolean }>) => Promise<Set<string>> }) => {
        picked = await opts.confirm?.("Submodule ignore-dirty", [
          { label: "Assets/Supercent/Luna", preselected: true },
          { label: "Assets/ThirdParty/Foo", preselected: false },
        ]);
      }
    );

    const prompt = fakePrompt([["Assets/Supercent/Luna"]]); // multiselect answer
    await runSetupOp("ignore-dirty", { target: "/projects/luna/Assets" }, prompt);

    expect(prompt.calls.some((c) => c.type === "multiselect")).toBe(true);
    expect(picked).toEqual(new Set(["Assets/Supercent/Luna"]));
  });

  it("ignore-dirty -y: confirm resolves preselected labels without prompting", async () => {
    let picked: Set<string> | undefined;
    handlerMocks.toggleSubmoduleIgnore.mockImplementation(
      async (_t: string, opts: { confirm?: (title: string, items: Array<{ label: string; preselected: boolean }>) => Promise<Set<string>> }) => {
        picked = await opts.confirm?.("Submodule ignore-dirty", [
          { label: "Assets/Supercent/Luna", preselected: true },
          { label: "Assets/ThirdParty/Foo", preselected: false },
        ]);
      }
    );

    const prompt = fakePrompt([]);
    await runSetupOp("ignore-dirty", {
      target:  "/projects/luna/Assets",
      autoYes: true,
    }, prompt);

    expect(interactiveCalls(prompt)).toHaveLength(0);
    expect(picked).toEqual(new Set(["Assets/Supercent/Luna"]));
  });

  // -------------------------------------------------------------------------
  // Surface strings + error path
  // -------------------------------------------------------------------------

  it("intro carries the direct command name (scvn <op>)", async () => {
    await runSetupOp("ignore-dirty", { target: "/projects/luna/Assets" }, fakePrompt([]));
    expect(output.join("")).toContain("scvn ignore-dirty");
  });

  it("sets exitCode 1 when a handler fails", async () => {
    handlerMocks.toggleSubmoduleIgnore.mockRejectedValueOnce(new Error("disk full"));

    await runSetupOp("ignore-dirty", { target: "/projects/luna/Assets" }, fakePrompt([]));

    expect(process.exitCode).toBe(1);
  });
});
