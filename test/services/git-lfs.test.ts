/**
 * test/services/git-lfs.test.ts — LFS git-service wrappers.
 *
 * Mocks execa + commandExists to lock the exact subprocess arg shape without
 * requiring git-lfs to be installed on the test machine.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("execa", () => ({ execa: vi.fn().mockResolvedValue({ stdout: "" }) }));
vi.mock("../../src/util/command-exists.js", () => ({
  commandExists: vi.fn(),
}));

import { execa } from "execa";
import { commandExists } from "../../src/util/command-exists.js";
import { detectGitLfs, gitLfsInstallLocal } from "../../src/services/git.js";

const execaMock = vi.mocked(execa);
const commandExistsMock = vi.mocked(commandExists);

beforeEach(() => {
  execaMock.mockClear();
  commandExistsMock.mockReset();
});

describe("detectGitLfs", () => {
  it("returns true when git-lfs resolves in PATH", async () => {
    commandExistsMock.mockResolvedValue(true);
    expect(await detectGitLfs()).toBe(true);
    expect(commandExistsMock).toHaveBeenCalledWith("git-lfs");
  });

  it("returns false when git-lfs is absent", async () => {
    commandExistsMock.mockResolvedValue(false);
    expect(await detectGitLfs()).toBe(false);
  });
});

describe("gitLfsInstallLocal", () => {
  it("runs `git -C <repo> lfs install --local`", async () => {
    await gitLfsInstallLocal("/repo/root");
    expect(execaMock).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo/root", "lfs", "install", "--local"],
      { stdio: "pipe" },
    );
  });
});
