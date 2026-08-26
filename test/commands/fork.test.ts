/**
 * test/commands/fork.test.ts — Flow-level tests for commands/fork.ts
 *
 * fork now configures ONLY Fork.app prefs — no git config, no per-project
 * .gitattributes, no project scan/picker. Uses fakePrompt to script TTY
 * interactions and mocks the detectors + writer so no real Fork.app / git /
 * filesystem access is needed. Verifies:
 *   - macOS-only guard: non-darwin → exitCode 1, no writer
 *   - precheck aborts (Fork running / Beyond Compare missing / no Unity) → exitCode 1, no writer
 *   - happy path (interactive) → writeForkPrefs invoked with the picked editor's yamlMergePath
 *   - no project scan or picker prompt happens
 *   - confirm DECLINE → writer NOT called (destructive-op lock)
 *   - dry-run → writer NOT called, no error
 *   - autoYes → zero confirm prompts, no project-root config gate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakePrompt } from "../../src/ui/prompt.js";

// ---------------------------------------------------------------------------
// Suppress clack output + control process.platform / exitCode
// ---------------------------------------------------------------------------

let origStdout: typeof process.stdout.write;
let origStderr: typeof process.stderr.write;
const origPlatform = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

beforeEach(() => {
  origStdout = process.stdout.write.bind(process.stdout);
  origStderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  process.exitCode = undefined;
  setPlatform("darwin"); // default: all tests assume macOS unless they override
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
  process.exitCode = undefined;
  Object.defineProperty(process, "platform", { value: origPlatform, configurable: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const detectMocks = vi.hoisted(() => ({
  detectForkRunning:   vi.fn(),
  detectBeyondCompare: vi.fn(),
  detectUnityVersions: vi.fn(),
}));

const writerMocks = vi.hoisted(() => ({
  writeForkPrefs: vi.fn(),
}));

vi.mock("../../src/detectors/detect-fork-running.js",   () => ({ detectForkRunning:   detectMocks.detectForkRunning }));
vi.mock("../../src/detectors/detect-beyond-compare.js", () => ({ detectBeyondCompare: detectMocks.detectBeyondCompare }));
vi.mock("../../src/detectors/detect-unity-versions.js", () => ({ detectUnityVersions: detectMocks.detectUnityVersions }));
vi.mock("../../src/writers/write-fork-prefs.js",        () => ({ writeForkPrefs:      writerMocks.writeForkPrefs }));

import { runFork, forkPreflight, forkExecute, FORK_MACOS_ONLY_MESSAGE } from "../../src/commands/fork.js";

// ---------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------

const UNITY = [{
  editorPath:    "/Applications/Unity/Hub/Editor/2022.3.10f1/Unity.app",
  version:       "2022.3.10f1",
  yamlMergePath: "/Applications/Unity/Hub/Editor/2022.3.10f1/Unity.app/Contents/Tools/UnityYAMLMerge",
}, {
  editorPath:    "/Applications/Unity/Hub/Editor/6000.0.1f1/Unity.app",
  version:       "6000.0.1f1",
  yamlMergePath: "/Applications/Unity/Hub/Editor/6000.0.1f1/Unity.app/Contents/Tools/UnityYAMLMerge",
}];

/** Reset all mocks to a passing-precheck baseline. */
function resetMocks(): void {
  detectMocks.detectForkRunning.mockResolvedValue(false);
  detectMocks.detectBeyondCompare.mockResolvedValue({ found: true, path: "/Applications/Beyond Compare.app" });
  detectMocks.detectUnityVersions.mockResolvedValue(UNITY);
  writerMocks.writeForkPrefs.mockResolvedValue({ backupPath: "/tmp/fork.plist.bak" });
}

/** Scripted answers for the interactive happy path: unity-select, confirm. */
function happyAnswers(confirm: boolean): Array<string | string[] | boolean> {
  return [
    UNITY[0]!.editorPath, // pick-unity select
    confirm,              // apply confirm gate
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runFork()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // macOS guard
  // -------------------------------------------------------------------------

  it("non-darwin: sets exitCode 1 and runs no detectors/writer", async () => {
    setPlatform("linux");
    await runFork({}, fakePrompt([]));
    expect(process.exitCode).toBe(1);
    expect(detectMocks.detectForkRunning).not.toHaveBeenCalled();
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Precheck aborts
  // -------------------------------------------------------------------------

  it("Fork running: aborts with exitCode 1, no writer", async () => {
    detectMocks.detectForkRunning.mockResolvedValue(true);
    await runFork({}, fakePrompt([]));
    expect(process.exitCode).toBe(1);
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
  });

  it("Beyond Compare missing: aborts with exitCode 1, no writer", async () => {
    detectMocks.detectBeyondCompare.mockResolvedValue({ found: false, path: "" });
    await runFork({}, fakePrompt([]));
    expect(process.exitCode).toBe(1);
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
  });

  it("no Unity editor: aborts with exitCode 1, no writer", async () => {
    detectMocks.detectUnityVersions.mockResolvedValue([]);
    await runFork({}, fakePrompt([]));
    expect(process.exitCode).toBe(1);
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Happy path — Fork prefs only
  // -------------------------------------------------------------------------

  it("interactive happy path: invokes writeForkPrefs with the picked editor's yamlMergePath", async () => {
    await runFork({}, fakePrompt(happyAnswers(true)));
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledOnce();
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ yamlMergePath: UNITY[0]!.yamlMergePath }),
    );
    expect(process.exitCode).not.toBe(1);
  });

  it("no project scan or picker: only a unity-select then confirm are prompted", async () => {
    const prompt = fakePrompt(happyAnswers(true));
    await runFork({}, prompt);
    // Exactly one select (unity) and no text/multiselect prompts — the project
    // scan/picker sub-flow is gone.
    expect(prompt.calls.filter((c) => c.type === "select")).toHaveLength(1);
    expect(prompt.calls.some((c) => c.type === "text")).toBe(false);
    expect(prompt.calls.some((c) => c.type === "multiselect")).toBe(false);
    const sel = prompt.calls.find((c) => c.type === "select");
    expect(sel?.message).toBe("Pick Unity editor");
  });

  it("pick-unity: a non-default editor choice feeds its own yamlMergePath", async () => {
    const prompt = fakePrompt([UNITY[1]!.editorPath, true]);
    await runFork({}, prompt);
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ yamlMergePath: UNITY[1]!.yamlMergePath }),
    );
  });

  // -------------------------------------------------------------------------
  // Destructive-op lock: confirm DECLINE → no writer
  // -------------------------------------------------------------------------

  it("confirm declined: writer is NOT called", async () => {
    const prompt = fakePrompt(happyAnswers(false));
    await runFork({}, prompt);
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
    expect(prompt.calls.some((c) => c.type === "confirm")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Dry-run: no writes
  // -------------------------------------------------------------------------

  it("dry-run (-n -y): no writer called, no error exit", async () => {
    await runFork({ dryRun: true, autoYes: true }, fakePrompt([]));
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
    expect(process.exitCode).not.toBe(1);
  });

  // -------------------------------------------------------------------------
  // autoYes: zero confirm prompts, no project-root config gate
  // -------------------------------------------------------------------------

  it("autoYes (-y): no confirm prompt, writes Fork prefs, no config gate", async () => {
    // No SCVN_PROJECTS_ROOT and no config mock — fork no longer needs the root.
    delete process.env["SCVN_PROJECTS_ROOT"];
    const prompt = fakePrompt([]);
    await runFork({ autoYes: true }, prompt);
    expect(prompt.calls.filter((c) => c.type === "confirm")).toHaveLength(0);
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledOnce();
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ yamlMergePath: UNITY[0]!.yamlMergePath }),
    );
    expect(process.exitCode).not.toBe(1);
  });

  it("beyondCompare:false with BC absent: writes prefs (no diff), no abort", async () => {
    detectMocks.detectBeyondCompare.mockResolvedValue({ found: false, path: "" });
    await runFork({ beyondCompare: false, autoYes: true }, fakePrompt([]));
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ setupBeyondCompare: false }),
    );
    expect(process.exitCode).not.toBe(1);
  });
});

describe("forkPreflight()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it("ok path: returns the detected editors + Beyond Compare path", async () => {
    const pre = await forkPreflight();
    expect(pre.ok).toBe(true);
    expect(pre.blocker).toBeNull();
    expect(pre.beyondComparePath).toBe("/Applications/Beyond Compare.app");
    expect(pre.unityVersions).toEqual(UNITY);
  });

  it("non-darwin: blocker set, detectors never run", async () => {
    setPlatform("linux");
    const pre = await forkPreflight();
    expect(pre.ok).toBe(false);
    expect(pre.blocker).toBe(FORK_MACOS_ONLY_MESSAGE);
    expect(detectMocks.detectForkRunning).not.toHaveBeenCalled();
  });

  it("Fork running → blocker", async () => {
    detectMocks.detectForkRunning.mockResolvedValue(true);
    const pre = await forkPreflight();
    expect(pre.ok).toBe(false);
    expect(pre.blocker).toMatch(/Fork is running/);
  });

  it("no Beyond Compare → blocker", async () => {
    detectMocks.detectBeyondCompare.mockResolvedValue({ found: false, path: "" });
    const pre = await forkPreflight();
    expect(pre.ok).toBe(false);
    expect(pre.blocker).toMatch(/Beyond Compare not found/);
  });

  it("requireBeyondCompare:false — a missing Beyond Compare is not a blocker", async () => {
    detectMocks.detectBeyondCompare.mockResolvedValue({ found: false, path: "" });
    const pre = await forkPreflight({ requireBeyondCompare: false });
    expect(pre.ok).toBe(true);
    expect(pre.beyondComparePath).toBeNull();
  });

  it("no Unity → blocker", async () => {
    detectMocks.detectUnityVersions.mockResolvedValue([]);
    const pre = await forkPreflight();
    expect(pre.ok).toBe(false);
    expect(pre.blocker).toMatch(/No Unity editor found/);
  });
});

describe("forkExecute()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  it("applies: writes Fork prefs with the given yamlMergePath, returns ok + backup", async () => {
    const result = await forkExecute({ yamlMergePath: UNITY[1]!.yamlMergePath, dryRun: false, setupBeyondCompare: true }, fakePrompt([]));
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ yamlMergePath: UNITY[1]!.yamlMergePath }),
    );
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBe("/tmp/fork.plist.bak");
  });

  it("dry-run: no writer call, still ok", async () => {
    const result = await forkExecute({ yamlMergePath: UNITY[0]!.yamlMergePath, dryRun: true, setupBeyondCompare: true }, fakePrompt([]));
    expect(writerMocks.writeForkPrefs).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("writer failure: returns ok:false with the error message", async () => {
    writerMocks.writeForkPrefs.mockRejectedValue(new Error("defaults write failed"));
    const result = await forkExecute({ yamlMergePath: UNITY[0]!.yamlMergePath, dryRun: false, setupBeyondCompare: true }, fakePrompt([]));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/defaults write failed/);
  });

  it("setupBeyondCompare=false: threads the flag to the writer", async () => {
    await forkExecute({ yamlMergePath: UNITY[0]!.yamlMergePath, dryRun: false, setupBeyondCompare: false }, fakePrompt([]));
    expect(writerMocks.writeForkPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ setupBeyondCompare: false }),
    );
  });
});
