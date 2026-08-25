/**
 * test/services/git.test.ts — Integration tests for listNestedGitignores and
 * getGitInfoExcludePath.
 *
 * Uses a REAL temporary git repo (no mocking) to prove the git-native
 * enumeration actually: excludes the repo-root .gitignore, returns both tracked
 * and untracked-non-ignored nested files, and skips git-ignored dirs plus
 * embedded/submodule repo contents (git ls-files never descends into gitlinks).
 */

import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { access, mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  getGitInfoExcludePath,
  gitRmCached,
  listNestedGitignores,
  listSubmoduleGitmodulesIgnore,
  listTrackedIgnoredFiles,
} from "../../src/services/git.js";

async function initRepo(dir: string): Promise<void> {
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "scvn-test"], { cwd: dir });
}

async function writeAt(dir: string, rel: string, content = "x\n"): Promise<void> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

describe("listNestedGitignores", () => {
  it("returns nested tracked + untracked, excludes root, skips ignored dirs and embedded repos", async () => {
    const dir = await tmpDir("scvn-git-");
    await initRepo(dir);

    // repo-root .gitignore (tracked) — MUST be excluded from results
    await writeAt(dir, ".gitignore", "Library/\n");
    // tracked nested
    await writeAt(dir, "Assets/Foo/.gitignore", "*.tmp\n");
    // untracked-but-not-ignored nested
    await writeAt(dir, "Bar/.gitignore", "*.log\n");
    // nested under a git-ignored dir → MUST be skipped (--exclude-standard)
    await writeAt(dir, "Library/.gitignore");
    // a same-suffix file that is NOT literally ".gitignore" → MUST be skipped
    await writeAt(dir, "Assets/keep.gitignore");
    // embedded nested repo → its .gitignore MUST be skipped (gitlink, not descended)
    await writeAt(dir, "Sub/.gitignore");
    await initRepo(path.join(dir, "Sub"));

    await execa("git", ["add", ".gitignore", "Assets/Foo/.gitignore"], { cwd: dir });

    const result = await listNestedGitignores(dir);

    expect([...result].sort()).toEqual(["Assets/Foo/.gitignore", "Bar/.gitignore"]);
  });

  it("returns [] for a non-git directory", async () => {
    const dir = await tmpDir("scvn-nogit-");
    expect(await listNestedGitignores(dir)).toEqual([]);
  });
});

describe("getGitInfoExcludePath", () => {
  const GIT_DIR = ".git";

  it("returns the absolute exclude path from the repo root", async () => {
    const dir = await tmpDir("scvn-excl-repo-");
    await initRepo(dir);

    const result = await getGitInfoExcludePath(dir);

    expect(result).toBe(path.join(dir, GIT_DIR, "info", "exclude"));
  });

  it("resolves the same absolute path from a nested subdirectory", async () => {
    const dir = await tmpDir("scvn-excl-sub-");
    await initRepo(dir);
    await mkdir(path.join(dir, "Assets"), { recursive: true });

    const result = await getGitInfoExcludePath(path.join(dir, "Assets"));

    expect(result).toBe(path.join(dir, GIT_DIR, "info", "exclude"));
  });

  it("points a submodule at its real gitdir, not the gitlink file", async () => {
    // A submodule's `.git` is a FILE. Joining `<toplevel>/.git/info/exclude`
    // would try to write beneath it (ENOTDIR); the real exclude lives under the
    // superproject's modules/ directory.
    const dir = await tmpDir("scvn-excl-submod-");
    const upstream = path.join(dir, "upstream");
    const superRepo = path.join(dir, "super");
    await mkdir(upstream, { recursive: true });
    await mkdir(superRepo, { recursive: true });
    await initRepo(upstream);
    await execa("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: upstream });
    await initRepo(superRepo);
    await execa(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "sub"],
      { cwd: superRepo },
    );

    const result = await getGitInfoExcludePath(path.join(superRepo, "sub"));

    // git hands back an absolute, symlink-resolved path here (macOS /var → /private/var).
    const realSuper = await realpath(superRepo);
    expect(result).toBe(path.join(realSuper, GIT_DIR, "modules", "sub", "info", "exclude"));
  });

  it("returns null for a non-git directory", async () => {
    const dir = await tmpDir("scvn-excl-nogit-");
    expect(await getGitInfoExcludePath(dir)).toBeNull();
  });
});

describe("listTrackedIgnoredFiles + gitRmCached", () => {
  it("lists tracked-but-now-ignored files (NUL-safe) and rm --cached drops them from the index, keeping the worktree", async () => {
    const repo = await tmpDir("scvn-untrack-");
    await initRepo(repo);
    await writeAt(repo, "Assets/keep.cs", "code\n");
    await writeAt(repo, "Assets/debug.log", "log\n");
    await writeAt(repo, "Assets/a b.tmp", "tmp\n"); // space in name → NUL-safety
    await execa("git", ["add", "-A"], { cwd: repo });
    await execa("git", ["commit", "-qm", "init", "--no-gpg-sign"], { cwd: repo });

    // A fresh .gitignore now matches two of the tracked files.
    await writeFile(path.join(repo, ".gitignore"), "*.log\n*.tmp\n");

    const ignored = await listTrackedIgnoredFiles(repo);
    expect([...ignored].sort()).toEqual(["Assets/a b.tmp", "Assets/debug.log"]);

    await gitRmCached(repo, ignored);

    expect(await listTrackedIgnoredFiles(repo)).toEqual([]);
    const tracked = (await execa("git", ["ls-files"], { cwd: repo })).stdout;
    expect(tracked).toContain("Assets/keep.cs");
    expect(tracked).not.toContain("debug.log");
    expect(tracked).not.toContain("a b.tmp");

    // Worktree copies remain on disk (index-only removal).
    await expect(access(path.join(repo, "Assets/debug.log"))).resolves.toBeUndefined();
    await expect(access(path.join(repo, "Assets/a b.tmp"))).resolves.toBeUndefined();
  });

  it("returns [] for a non-git directory; gitRmCached no-ops on an empty list", async () => {
    const dir = await tmpDir("scvn-untrack-nogit-");
    expect(await listTrackedIgnoredFiles(dir)).toEqual([]);
    await expect(gitRmCached(dir, [])).resolves.toBeUndefined();
  });
});

describe("listSubmoduleGitmodulesIgnore", () => {
  it("maps submodule NAME -> .gitmodules ignore value, omitting submodules with no ignore line", async () => {
    const repo = await tmpDir("scvn-gitmodules-ignore-");
    await initRepo(repo);
    await writeFile(
      path.join(repo, ".gitmodules"),
      [
        '[submodule "Plugins"]',
        "\tpath = Plugins",
        "\turl = ../plugins.git",
        '[submodule "vendored"]', // name != path, ignore baked in
        "\tpath = Third/Vendored",
        "\turl = ../vendored.git",
        "\tignore = dirty",
        '[submodule "docs"]',
        "\tpath = docs",
        "\turl = ../docs.git",
        "\tignore = all",
        "",
      ].join("\n"),
    );

    // Keyed on NAME; "Plugins" has no ignore line so it is absent.
    expect(await listSubmoduleGitmodulesIgnore(repo)).toEqual({ vendored: "dirty", docs: "all" });
  });

  it("returns {} for a repo with no .gitmodules and for a non-git directory", async () => {
    const repo = await tmpDir("scvn-gitmodules-none-");
    await initRepo(repo);
    expect(await listSubmoduleGitmodulesIgnore(repo)).toEqual({});

    const plain = await tmpDir("scvn-gitmodules-plain-");
    expect(await listSubmoduleGitmodulesIgnore(plain)).toEqual({});
  });
});
