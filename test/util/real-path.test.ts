/**
 * test/util/real-path.test.ts — Path normalization against git's realpath output.
 *
 * The bug this guards: `git rev-parse --show-toplevel` prints a symlink-resolved
 * path, so comparing it against an unresolved caller path produces a nonsense
 * relative traversal. That silently broke BOTH the exclude fence (patterns match
 * nothing → the vendored source shows up as thousands of untracked files) and
 * the porcelain gate (pathspec points nowhere → the gate asserts nothing and
 * passes). macOS symlinks /tmp and /var, so it is the default there, not an edge.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdir, symlink } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { toRealPath } from "../../src/util/real-path.js";

describe("toRealPath", () => {
  it("resolves a symlinked path to its real location", async () => {
    const root = await tmpDir("scvn-real-");
    const real = path.join(root, "real");
    const link = path.join(root, "link");
    await mkdir(real, { recursive: true });
    await symlink(real, link);

    expect(await toRealPath(link)).toBe(await toRealPath(real));
  });

  it("agrees with what git reports as the repo root", async () => {
    // The actual regression: tmpDir hands back /var/... while git prints /private/var/...
    const repo = await tmpDir("scvn-real-");
    await mkdir(path.join(repo, "Assets"), { recursive: true });
    await execa("git", ["init", "-q"], { cwd: repo });
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd: repo });

    const normalized = await toRealPath(path.join(repo, "Assets"));

    expect(path.relative(stdout.trim(), path.dirname(normalized))).toBe("");
  });

  it("returns an absolute path for one that does not exist", async () => {
    expect(await toRealPath("relative/missing")).toBe(
      path.resolve("relative/missing"),
    );
  });
});
