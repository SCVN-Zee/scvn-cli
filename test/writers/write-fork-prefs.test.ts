/**
 * test/writers/write-fork-prefs.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async (_cmd: string, _args: string[]) => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  })),
}));

vi.mock("execa", () => ({ execa: execaMock }));

import {
  FORK_TOOL_ENUM,
  writeForkPrefs,
} from "../../src/writers/write-fork-prefs.js";

describe("FORK_TOOL_ENUM (observed Fork 2.66.6 rawValues)", () => {
  it("fileMerge=0, beyondCompare=1, custom=8, unity3d=9", () => {
    expect(FORK_TOOL_ENUM.fileMerge).toBe(0);
    expect(FORK_TOOL_ENUM.beyondCompare).toBe(1);
    expect(FORK_TOOL_ENUM.custom).toBe(8);
    expect(FORK_TOOL_ENUM.unity3d).toBe(9);
  });
});

describe("writeForkPrefs", () => {
  beforeEach(() => execaMock.mockClear());

  it("sets externalDiffTool=beyondCompare(1), mergeTool=custom(8), custom path + array args", async () => {
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

    expect(byKey.get("externalDiffTool")?.slice(3)).toEqual(["-int", "1"]);
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

  it("deletes legacy + stale diff-custom keys", async () => {
    await writeForkPrefs({ yamlMergePath: "/tmp/unity" });
    const deleted = execaMock.mock.calls
      .map((c) => c as unknown as [string, string[]])
      .filter(([cmd, args]) => cmd === "defaults" && args[0] === "delete")
      .map((c) => c[1][2]);
    expect(deleted).toEqual(
      expect.arrayContaining([
        "externalDiffToolCustomPath",
        "externalDiffToolCustomArguments",
        "ExternalDiffTool",
        "ExternalMergeTool",
      ]),
    );
  });

  it("quits Fork and flushes cfprefsd cache", async () => {
    await writeForkPrefs({ yamlMergePath: "/tmp/unity" });
    const calls = execaMock.mock.calls.map(
      (c) => c as unknown as [string, string[]],
    );
    expect(
      calls.some(
        ([cmd, args]) =>
          cmd === "osascript" &&
          args[0] === "-e" &&
          args[1]?.includes('quit app "Fork"'),
      ),
    ).toBe(true);
    expect(
      calls.some(([cmd, args]) => cmd === "killall" && args[0] === "cfprefsd"),
    ).toBe(true);
  });
});
