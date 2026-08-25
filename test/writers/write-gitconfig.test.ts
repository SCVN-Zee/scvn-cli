/**
 * test/writers/write-gitconfig.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
}));

vi.mock("execa", () => ({
  execa: execaMock,
}));

import {
  buildDriverArgs,
  writeGitConfig,
} from "../../src/writers/write-gitconfig.js";

describe("buildDriverArgs", () => {
  it("no --nomappinginoneline for Unity 2022.x", () => {
    expect(buildDriverArgs("2022.3.19f1")).toEqual([
      "merge", "-p", "--force", "--fallback", "none", "%O", "%B", "%A", "%P",
    ]);
  });
  it("inserts --nomappinginoneline for Unity 6", () => {
    expect(buildDriverArgs("6000.0.1f1")).toEqual([
      "merge", "-p", "--nomappinginoneline", "--force", "--fallback", "none", "%O", "%B", "%A", "%P",
    ]);
  });
});

describe("writeGitConfig (execa spy)", () => {
  beforeEach(() => execaMock.mockClear());

  it("sets both merge-driver and mergetool sections", async () => {
    const r = await writeGitConfig({
      yamlMergePath: "/path/to/UnityYAMLMerge",
      unityVersion: "2022.3.19f1",
    });
    expect(r.driverSet).toBe(true);
    expect(r.mergetoolSet).toBe(true);

    const keys = execaMock.mock.calls.map(
      (c) => ((c as unknown as [string, string[]])[1][2]),
    );
    expect(keys).toContain("merge.unityyamlmerge.driver");
    expect(keys).toContain("mergetool.unityyamlmerge.cmd");
    expect(keys).toContain("merge.unityyamlmerge.name");
    expect(keys).toContain("merge.unityyamlmerge.recursive");
    expect(keys).toContain("mergetool.unityyamlmerge.trustExitCode");
  });
});
