/**
 * test/writers/write-fork-prefs.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execaMock, quitMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async (_cmd: string, _args: string[]) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  })),
  quitMock: vi.fn(async () => "not-running" as const),
}));

vi.mock("execa", () => ({ execa: execaMock }));
vi.mock("../../src/lib/quit-fork.js", () => ({
  quitForkApp: quitMock,
  FORK_QUIT_TIMEOUT_MESSAGE: "Fork did not quit in time — quit Fork manually and re-run.",
}));

import {
  writeForkPrefs,
} from "../../src/writers/write-fork-prefs.js";

describe("writeForkPrefs", () => {
  beforeEach(() => {
    execaMock.mockClear();
    quitMock.mockClear();
    quitMock.mockResolvedValue("not-running");
  });

  it("sets the custom Unity merge tool, path and array arguments", async () => {
    const r = await writeForkPrefs({
      yamlMergePath:
        "/Applications/Unity/Hub/Editor/2022.3.16f1/Unity.app/Contents/Tools/UnityYAMLMerge",
    });
    expect(r.mergePathWritten).toBe(
      "/Applications/Unity/Hub/Editor/2022.3.16f1/Unity.app/Contents/Tools/UnityYAMLMerge",
    );

    const writes = execaMock.mock.calls
      .map((c) => c as unknown as [string, string[]])
      .filter(([cmd, args]) => cmd === "defaults" && args[0] === "write");
    const byKey = new Map(writes.map(([, args]) => [args[2]!, args]));

    expect(byKey.get("mergeTool")?.slice(3)).toEqual(["-int", "8"]);
    expect(byKey.get("externalMergeToolCustomPath")?.slice(3)).toEqual([
      "-string",
      "/Applications/Unity/Hub/Editor/2022.3.16f1/Unity.app/Contents/Tools/UnityYAMLMerge",
    ]);
    expect(byKey.get("externalMergeToolCustomArguments")?.slice(3)).toEqual([
      "-array",
      "merge",
      "-p",
      "$BASE",
      "$REMOTE",
      "$LOCAL",
      "$MERGED",
    ]);
  });

  it("never writes or deletes existing diff preferences", async () => {
    await writeForkPrefs({ yamlMergePath: "/tmp/unity" });
    const keys = execaMock.mock.calls
      .map((c) => c as unknown as [string, string[]])
      .filter(([cmd, args]) => cmd === "defaults" && ["write", "delete"].includes(args[0]!))
      .map(([, args]) => args[2]);
    expect(keys.filter((key) => /diff/i.test(key!))).toEqual([]);
    expect(keys).toContain("mergeTool");
    expect(keys).toContain("externalMergeToolCustomPath");
  });

  it("removes only the legacy merge key", async () => {
    await writeForkPrefs({ yamlMergePath: "/tmp/unity" });
    const deleted = execaMock.mock.calls
      .map((c) => c as unknown as [string, string[]])
      .filter(([cmd, args]) => cmd === "defaults" && args[0] === "delete")
      .map((c) => c[1][2]);
    expect(deleted).toEqual(["ExternalMergeTool"]);
  });

  it("waits for Fork to be gone (quit-and-wait) and flushes cfprefsd cache", async () => {
    quitMock.mockResolvedValue("quit");
    await writeForkPrefs({ yamlMergePath: "/tmp/unity" });
    expect(quitMock).toHaveBeenCalledOnce();
    // The fire-and-forget osascript quit is gone — quitting is quit-fork's job.
    const calls = execaMock.mock.calls.map(
      (c) => c as unknown as [string, string[]],
    );
    expect(
      calls.some(([cmd, args]) => cmd === "osascript" && args[0] === "-e"),
    ).toBe(false);
    expect(
      calls.some(([cmd, args]) => cmd === "killall" && args[0] === "cfprefsd"),
    ).toBe(true);
  });

  it("quit timeout: throws BEFORE any defaults write or backup", async () => {
    quitMock.mockResolvedValue("timeout");
    await expect(
      writeForkPrefs({ yamlMergePath: "/tmp/unity" }),
    ).rejects.toThrow(/quit Fork manually/);
    expect(
      execaMock.mock.calls.some(
        (c) => (c as unknown as [string, string[]])[0] === "defaults",
      ),
    ).toBe(false);
  });
});
