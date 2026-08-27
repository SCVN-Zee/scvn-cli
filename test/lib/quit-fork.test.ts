/**
 * test/lib/quit-fork.test.ts — Graceful quit-and-wait for Fork.app.
 *
 * Fork flushes its prefs (via cfprefsd) while quitting, so the helper must
 * prove: no Apple Event when Fork is not running; a graceful bundle-id quit
 * followed by exit-polling when it is; and an honest "timeout" (never a
 * kill) when Fork refuses to leave.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execaMock, detectMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
  detectMock: vi.fn(),
}));

vi.mock("execa", () => ({ execa: execaMock }));
vi.mock("../../src/detectors/detect-fork-running.js", () => ({ detectForkRunning: detectMock }));

import { quitForkApp, reopenForkApp, FORK_QUIT_TIMEOUT_MESSAGE } from "../../src/lib/quit-fork.js";

describe("quitForkApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execaMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("not running → 'not-running', no Apple Event sent", async () => {
    detectMock.mockResolvedValue(false);
    expect(await quitForkApp({ settleMs: 0 })).toBe("not-running");
    expect(execaMock).not.toHaveBeenCalled();
  });

  it("running → graceful bundle-id quit, polls until exit → 'quit'", async () => {
    // First detect says running; the poll after the quit event says exited.
    detectMock.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await quitForkApp({ settleMs: 0 })).toBe("quit");

    const osascript = execaMock.mock.calls.find(
      (c) => (c as unknown as [string, string[]])[0] === "osascript",
    ) as unknown as [string, string[]];
    expect(osascript?.[1]).toEqual(["-e", 'quit app id "com.DanPristupov.Fork"']);
  });

  it("still running past the deadline → 'timeout', never a kill", async () => {
    detectMock.mockResolvedValue(true);
    expect(await quitForkApp({ timeoutMs: 30, pollMs: 5, settleMs: 0 })).toBe("timeout");
    const commands = execaMock.mock.calls.map(
      (c) => (c as unknown as [string, string[]])[0],
    );
    expect(commands).toEqual(["osascript"]); // graceful quit only — no pkill/kill
  });

  it("timeout message tells the user to quit manually", () => {
    expect(FORK_QUIT_TIMEOUT_MESSAGE).toMatch(/quit Fork manually/);
  });
});

describe("reopenForkApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execaMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  it("reopens by bundle id; true on exit 0", async () => {
    expect(await reopenForkApp()).toBe(true);
    const open = execaMock.mock.calls.find(
      (c) => (c as unknown as [string, string[]])[0] === "open",
    ) as unknown as [string, string[]];
    expect(open?.[1]).toEqual(["-b", "com.DanPristupov.Fork"]);
  });

  it("false on non-zero exit (best-effort — caller surfaces it)", async () => {
    execaMock.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "" });
    expect(await reopenForkApp()).toBe(false);
  });
});
