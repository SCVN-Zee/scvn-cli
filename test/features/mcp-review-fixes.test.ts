/**
 * test/features/mcp-review-fixes.test.ts — Regressions found by review, pinned.
 *
 * Each of these shipped green in the phase suites and was caught only by an
 * adversarial read (or by running the thing). They are grouped here because what
 * they have in common is the failure MODE: a guard that silently does nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { assertUnityAssetsDir } from "../../src/features/mcp/assert-unity-project.js";
import { porcelainGate } from "../../src/features/mcp/porcelain-gate.js";
import { resolveCliForCore } from "../../src/features/mcp/resolve-mcp-cache.js";
import { listCliDirs, cliDirName } from "../../src/features/mcp/mcp-cache-paths.js";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import {
  _setBundledMcpRootForTest,
  _resetBundledMcpCache,
} from "../../src/features/mcp/bundled-mcp-paths.js";
import { MACHINERY_FILES } from "../../src/features/mcp/mcp-constants.js";

beforeEach(() => {
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
});

// ---------------------------------------------------------------------------
// A one-token typo used to vendor 60 MB outside the repo and report success.
// ---------------------------------------------------------------------------

describe("assertUnityAssetsDir", () => {
  async function makeProject(): Promise<string> {
    const root = await tmpDir("scvn-proj-");
    const project = path.join(root, "Game");
    await mkdir(path.join(project, "Assets"), { recursive: true });
    await mkdir(path.join(project, "Packages"), { recursive: true });
    await writeFile(path.join(project, "Packages", "manifest.json"), "{}\n");
    return project;
  }

  it("accepts a real project's Assets dir", async () => {
    const project = await makeProject();

    await expect(assertUnityAssetsDir(path.join(project, "Assets"))).resolves.toBeUndefined();
  });

  it("REFUSES the project root — the `--target <project>` typo, which is the dangerous one", async () => {
    // `--target .../Game` instead of `.../Game/Assets` makes dirname() the
    // PROJECTS ROOT: install then vendors into <projects-root>/Assets/UnityMCP,
    // outside any repo, and every downstream gate passes because they are all
    // asking about a project that is not there.
    const project = await makeProject();

    await expect(assertUnityAssetsDir(project)).rejects.toThrow(/must be a Unity project's Assets/);
    await expect(assertUnityAssetsDir(project)).rejects.toThrow(/did you mean/);
  });

  it("REFUSES an Assets dir whose parent is not a Unity project", async () => {
    const root = await tmpDir("scvn-proj-");
    await mkdir(path.join(root, "Assets"), { recursive: true }); // no Packages/manifest.json

    await expect(assertUnityAssetsDir(path.join(root, "Assets"))).rejects.toThrow(
      /not a Unity project/,
    );
  });
});

// ---------------------------------------------------------------------------
// The gate that proves "nothing to commit" used to report PASS on ANY git error.
// ---------------------------------------------------------------------------

describe("porcelainGate — a git FAILURE is a failure", () => {
  it("throws instead of passing when the pathspec is outside the repo", async () => {
    const repo = await tmpDir("scvn-porcelain-");
    await execa("git", ["init", "-q"], { cwd: repo });
    await execa("git", ["config", "user.email", "t@e.c"], { cwd: repo });
    await execa("git", ["config", "user.name", "t"], { cwd: repo });
    await writeFile(path.join(repo, "f"), "x\n");
    await execa("git", ["add", "-A"], { cwd: repo });
    await execa("git", ["commit", "-qm", "i"], { cwd: repo });

    // A project OUTSIDE the repo — git rejects the resulting `../…` pathspec.
    // Swallowing that turned the one gate proving the headline invariant into a
    // no-op that always passed.
    const outside = path.join(path.dirname(repo), "elsewhere");

    await expect(porcelainGate(repo, outside)).rejects.toThrow(/could not run/);
  });

  it("still passes on a genuinely clean repo", async () => {
    const repo = await tmpDir("scvn-porcelain-");
    await mkdir(path.join(repo, "Packages"), { recursive: true });
    await mkdir(path.join(repo, "ProjectSettings"), { recursive: true });
    await execa("git", ["init", "-q"], { cwd: repo });
    await execa("git", ["config", "user.email", "t@e.c"], { cwd: repo });
    await execa("git", ["config", "user.name", "t"], { cwd: repo });
    for (const file of MACHINERY_FILES) {
      await writeFile(path.join(repo, file), "{}\n");
    }
    await execa("git", ["add", "-A"], { cwd: repo });
    await execa("git", ["commit", "-qm", "i"], { cwd: repo });

    await expect(porcelainGate(repo, repo)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The bundle shipped NO cli the moment npm lagged OpenUPM by one publish.
// ---------------------------------------------------------------------------

describe("resolveCliForCore — tolerates a CLI that lags core", () => {
  async function seedCli(cacheDir: string, version: string): Promise<void> {
    await mkdir(path.join(cacheDir, cliDirName(version), "bin"), { recursive: true });
    await writeFile(path.join(cacheDir, cliDirName(version), "bin", "unity-mcp-cli.js"), "//\n");
  }

  it("prefers the exact version", async () => {
    const cache = await tmpDir("scvn-cli-");
    await seedCli(cache, "0.83.0");
    await seedCli(cache, "0.83.1");

    const found = await resolveCliForCore("0.83.1", { userCacheDir: cache });

    expect(found?.version).toBe("0.83.1");
  });

  it("falls back to the newest CLI NOT EXCEEDING core (npm lagging OpenUPM)", async () => {
    const cache = await tmpDir("scvn-cli-");
    await seedCli(cache, "0.83.0");

    const found = await resolveCliForCore("0.83.1", { userCacheDir: cache });

    expect(found?.version).toBe("0.83.0");
  });

  it("never takes a NEWER client than core — the one pairing that can break", async () => {
    const cache = await tmpDir("scvn-cli-");
    await seedCli(cache, "0.90.0");

    expect(await resolveCliForCore("0.83.1", { userCacheDir: cache })).toBeNull();
  });

  it("finds a lagging CLI in the BUNDLE too", async () => {
    const bundle = await tmpDir("scvn-bundle-");
    const empty = await tmpDir("scvn-cli-");
    await seedCli(bundle, "0.83.0");
    _setBundledMcpRootForTest(bundle);

    const found = await resolveCliForCore("0.83.1", { userCacheDir: empty });

    expect(found).toMatchObject({ version: "0.83.0", source: "bundled" });
  });

  it("lists cached cli versions newest-first", async () => {
    const cache = await tmpDir("scvn-cli-");
    await seedCli(cache, "0.82.3");
    await seedCli(cache, "0.82.10");

    expect(await listCliDirs(cache)).toEqual(["0.82.10", "0.82.3"]);
  });
});

// ---------------------------------------------------------------------------
// A project path with regex metacharacters made pgrep exit non-zero, which the
// editor gate read as "Unity is not running".
// ---------------------------------------------------------------------------

describe("detectUnityRunning — the path is escaped, not injected", () => {
  it("passes a project path containing regex metacharacters to pgrep literally", async () => {
    vi.resetModules();
    const execaMock = vi.fn(async () => ({ exitCode: 1 }));
    vi.doMock("execa", () => ({ execa: execaMock }));
    const { detectUnityRunning } = await import("../../src/detectors/detect-unity-running.js");

    await detectUnityRunning("/p/Game (copy)/[v2]");

    const pattern = (execaMock.mock.calls[0]![1] as string[])[1]!;
    expect(pattern).toContain("\\(copy\\)");
    expect(pattern).toContain("\\[v2\\]");
    // The pattern must still be a VALID regex — an invalid one makes pgrep exit
    // non-zero, which the gate would read as "Unity is not running".
    expect(() => new RegExp(pattern)).not.toThrow();
  });
});
