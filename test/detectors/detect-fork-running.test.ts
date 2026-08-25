/**
 * test/detectors/detect-fork-running.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { execaMock } = vi.hoisted(() => ({
  execaMock: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "" })),
}));

vi.mock("execa", () => ({ execa: execaMock }));

import { detectForkRunning } from "../../src/detectors/detect-fork-running.js";

describe("detectForkRunning", () => {
  beforeEach(() => execaMock.mockClear());

  it("false when pgrep exits non-zero", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "" });
    expect(await detectForkRunning()).toBe(false);
  });

  it("true when pgrep exits zero", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stdout: "1234", stderr: "" });
    expect(await detectForkRunning()).toBe(true);
  });
});
