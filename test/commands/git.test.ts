/**
 * test/commands/git.test.ts — Flow-level tests for commands/git.ts (runGitCommand).
 *
 * Locked contract:
 *   - bare `scvn git` (no op flag) → prints the usage hint, exitCode 1, runs nothing
 *   - flags select ops; multiple flags run in order ignore → exclude → lfs
 *   - a failing op (e.g. --lfs) sets exit 1 but ops selected before it still run
 *   - --yes without a target fails loudly naming --target (never auto-picks)
 *
 * buildSetupHandlers is mocked so the test asserts which handler ran and in what
 * order, independent of the real template/prune/lfs behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakePrompt } from "../../src/ui/prompt.js";

// ---------------------------------------------------------------------------
// Capture stdout + stderr so hint / error contracts are assertable
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
  delete process.env["SCVN_TARGET"];
});

afterEach(() => {
  process.stdout.write = origStdout;
  process.stderr.write = origStderr;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Mock the setup handler map with spies
// ---------------------------------------------------------------------------

const handlerSpies = vi.hoisted(() => ({
  gitignore:  vi.fn().mockResolvedValue(undefined),
  gitexclude: vi.fn().mockResolvedValue(undefined),
  lfs:        vi.fn().mockResolvedValue(undefined),
}));
const buildMock = vi.hoisted(() => ({ buildSetupHandlers: vi.fn() }));

vi.mock("../../src/features/setup/index.js", () => buildMock);

import { runGitCommand } from "../../src/commands/git.js";

beforeEach(() => {
  vi.clearAllMocks();
  handlerSpies.gitignore.mockResolvedValue(undefined);
  handlerSpies.gitexclude.mockResolvedValue(undefined);
  handlerSpies.lfs.mockResolvedValue(undefined);
  buildMock.buildSetupHandlers.mockImplementation(() => ({
    gitignore:      handlerSpies.gitignore,
    gitexclude:     handlerSpies.gitexclude,
    lfs:            handlerSpies.lfs,
    "ignore-dirty": vi.fn(),
  }));
});

describe("runGitCommand()", () => {
  it("bare (no flags): prints the hint, exitCode 1, runs nothing", async () => {
    // The hint goes to console.error (usage-error convention); vitest intercepts
    // console.* so spy on it directly rather than the stream capture.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runGitCommand({}, fakePrompt([]));

    expect(process.exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("")).toContain("needs at least one op flag");
    expect(buildMock.buildSetupHandlers).not.toHaveBeenCalled();
    expect(handlerSpies.gitignore).not.toHaveBeenCalled();
    expect(handlerSpies.gitexclude).not.toHaveBeenCalled();
    expect(handlerSpies.lfs).not.toHaveBeenCalled();
  });

  it("runs all selected ops in order ignore → exclude → lfs", async () => {
    await runGitCommand(
      { ignore: true, exclude: true, lfs: true, target: "/p/Assets" },
      fakePrompt([]),
    );

    expect(handlerSpies.gitignore).toHaveBeenCalledOnce();
    expect(handlerSpies.gitexclude).toHaveBeenCalledOnce();
    expect(handlerSpies.lfs).toHaveBeenCalledOnce();

    const io = handlerSpies.gitignore.mock.invocationCallOrder[0]!;
    const eo = handlerSpies.gitexclude.mock.invocationCallOrder[0]!;
    const lo = handlerSpies.lfs.mock.invocationCallOrder[0]!;
    expect(io).toBeLessThan(eo);
    expect(eo).toBeLessThan(lo);
    expect(process.exitCode).toBeUndefined();
  });

  it("runs only the flagged ops", async () => {
    await runGitCommand({ exclude: true, target: "/p/Assets" }, fakePrompt([]));

    expect(handlerSpies.gitexclude).toHaveBeenCalledOnce();
    expect(handlerSpies.gitignore).not.toHaveBeenCalled();
    expect(handlerSpies.lfs).not.toHaveBeenCalled();
  });

  it("--lfs failure sets exit 1 but a co-selected --ignore still ran", async () => {
    handlerSpies.lfs.mockRejectedValueOnce(
      new Error("git-lfs not installed — brew install git-lfs"),
    );

    await runGitCommand({ ignore: true, lfs: true, target: "/p/Assets" }, fakePrompt([]));

    expect(handlerSpies.gitignore).toHaveBeenCalledOnce(); // ran before lfs
    expect(handlerSpies.lfs).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it("-y without a target: exitCode 1, names --target, runs nothing", async () => {
    await runGitCommand({ ignore: true, autoYes: true }, fakePrompt([]));

    expect(process.exitCode).toBe(1);
    expect(output.join("")).toContain("--target");
    expect(handlerSpies.gitignore).not.toHaveBeenCalled();
  });

  it("passes the resolved target + prune-confirm seam to buildSetupHandlers", async () => {
    await runGitCommand({ ignore: true, target: "/p/Assets" }, fakePrompt([]));

    expect(buildMock.buildSetupHandlers).toHaveBeenCalledWith(
      "/p/Assets",
      expect.objectContaining({ pruneConfirm: expect.any(Function) }),
    );
  });
});
