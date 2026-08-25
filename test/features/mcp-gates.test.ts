/**
 * test/features/mcp-gates.test.ts — The four refusals that stand between a bad
 * state and a broken Unity project.
 *
 * pin gate       — an addon skewed against the core compiles fine and fails at runtime
 * porcelain gate — the UPM machinery files must be byte-equal to HEAD by construction
 * reconcile      — an empty wanted set would sweep every vendored package
 * unity-running  — importing must not race the asset importer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access, readdir } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { pinGate } from "../../src/features/mcp/pin-gate.js";
import { porcelainGate } from "../../src/features/mcp/porcelain-gate.js";
import { reconcileImportRoot } from "../../src/features/mcp/reconcile-import-root.js";
import { writeVersionsJson } from "../../src/features/mcp/versions-json.js";
import { MACHINERY_FILES, CORE_PKG } from "../../src/features/mcp/mcp-constants.js";

const ADDON = "com.ivanmurzak.unity.mcp.animation";

function collectWarns() {
  const warns: string[] = [];
  return {
    reporter: {
      onStatus: () => {},
      onLog: (e: { level: string; message: string }) => {
        if (e.level === "warn") warns.push(e.message);
      },
    },
    warns,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function stagedWithPins(pins?: Record<string, boolean>): Promise<string> {
  const dir = await tmpDir("scvn-verdir-");
  await writeVersionsJson(dir, {
    core: "1.0.0",
    packages: { [CORE_PKG]: "1.0.0", [ADDON]: "2.0.0" },
    ...(pins ? { pins } : {}),
    fetchedAt: "2026-01-01T00:00:00Z",
  });
  return dir;
}

describe("pinGate", () => {
  it("passes an addon that pins this core", async () => {
    const dir = await stagedWithPins({ [ADDON]: true });

    await expect(pinGate(dir, "1.0.0", [CORE_PKG, ADDON])).resolves.toBeUndefined();
  });

  it("REFUSES an addon that pins a different core", async () => {
    const dir = await stagedWithPins({ [ADDON]: false });

    await expect(pinGate(dir, "1.0.0", [CORE_PKG, ADDON])).rejects.toThrow(/pin gate FAILED/);
    await expect(pinGate(dir, "1.0.0", [CORE_PKG, ADDON])).rejects.toThrow(new RegExp(ADDON));
  });

  it("lets --force through, with a warning that names the runtime risk", async () => {
    const dir = await stagedWithPins({ [ADDON]: false });
    const { reporter, warns } = collectWarns();

    await expect(
      pinGate(dir, "1.0.0", [CORE_PKG, ADDON], { force: true, reporter }),
    ).resolves.toBeUndefined();
    expect(warns.join("\n")).toMatch(/runtime/);
  });

  it("GRANDFATHERS a version dir with no pins key — an older cache is not a failure", async () => {
    const dir = await stagedWithPins(); // no `pins` at all

    await expect(pinGate(dir, "1.0.0", [CORE_PKG, ADDON])).resolves.toBeUndefined();
  });

  it("ignores a skewed addon that is not being installed", async () => {
    const dir = await stagedWithPins({ [ADDON]: false });

    await expect(pinGate(dir, "1.0.0", [CORE_PKG])).resolves.toBeUndefined();
  });
});

describe("porcelainGate", () => {
  async function repoWithProject(nested: boolean): Promise<{ repo: string; project: string }> {
    const repo = await tmpDir("scvn-porcelain-");
    const project = nested ? path.join(repo, "unity_project", "game") : repo;
    await mkdir(path.join(project, "Packages"), { recursive: true });
    await mkdir(path.join(project, "ProjectSettings"), { recursive: true });
    await execa("git", ["init", "-q"], { cwd: repo });
    await execa("git", ["config", "user.email", "t@e.c"], { cwd: repo });
    await execa("git", ["config", "user.name", "t"], { cwd: repo });
    for (const file of MACHINERY_FILES) {
      await writeFile(path.join(project, file), "{}\n");
    }
    await writeFile(path.join(repo, "unrelated.txt"), "keep\n");
    await execa("git", ["add", "-A"], { cwd: repo });
    await execa("git", ["commit", "-qm", "init"], { cwd: repo });
    return { repo, project };
  }

  it("passes when the three machinery files are clean", async () => {
    const { repo, project } = await repoWithProject(false);

    await expect(porcelainGate(repo, project)).resolves.toBeUndefined();
  });

  it("FAILS on a dirty manifest, naming the file", async () => {
    const { repo, project } = await repoWithProject(false);
    await writeFile(path.join(project, "Packages/manifest.json"), '{"dependencies":{"x":"1"}}\n');

    await expect(porcelainGate(repo, project)).rejects.toThrow(/porcelain gate FAILED/);
    await expect(porcelainGate(repo, project)).rejects.toThrow(/manifest\.json/);
  });

  it("ignores unrelated dirty files — the pathspec is scoped to the three", async () => {
    const { repo, project } = await repoWithProject(false);
    await writeFile(path.join(repo, "unrelated.txt"), "locally edited\n");

    await expect(porcelainGate(repo, project)).resolves.toBeUndefined();
  });

  it("scopes correctly for a project NESTED inside the repo", async () => {
    const { repo, project } = await repoWithProject(true);
    await expect(porcelainGate(repo, project)).resolves.toBeUndefined();

    await writeFile(path.join(project, "Packages/packages-lock.json"), '{"dirty":true}\n');
    await expect(porcelainGate(repo, project)).rejects.toThrow(/packages-lock\.json/);
  });

  it("THROWS when git itself fails — it must never claim clean without checking", async () => {
    // The caller only invokes this inside a repo, so a git error is never benign.
    // Swallowing it turned the gate that proves "nothing to commit" into a no-op
    // that always passed.
    const dir = await tmpDir("scvn-nogit-");

    await expect(porcelainGate(dir, dir)).rejects.toThrow(/could not run/);
  });
});

describe("reconcileImportRoot", () => {
  async function importRootWith(names: string[]): Promise<string> {
    const dir = await tmpDir("scvn-import-");
    for (const name of names) {
      await mkdir(path.join(dir, name), { recursive: true });
      await writeFile(path.join(dir, name, "file.cs"), "x\n");
      await writeFile(path.join(dir, `${name}.meta`), "meta\n");
    }
    await writeFile(path.join(dir, ".scvn-mcp.json"), "{}\n");
    return dir;
  }

  it("REFUSES an empty wanted set — that would sweep every vendored package", async () => {
    const dir = await importRootWith([CORE_PKG, ADDON]);

    await expect(reconcileImportRoot(dir, [])).rejects.toThrow(/empty wanted set/);

    // Nothing was touched.
    expect(await exists(path.join(dir, CORE_PKG))).toBe(true);
    expect(await exists(path.join(dir, ADDON))).toBe(true);
  });

  it("removes an orphan package with its .meta, sparing the wanted ones", async () => {
    const dir = await importRootWith([CORE_PKG, ADDON, "com.old.addon"]);

    const removed = await reconcileImportRoot(dir, [CORE_PKG, ADDON]);

    expect(removed).toEqual(["com.old.addon"]);
    expect(await exists(path.join(dir, "com.old.addon"))).toBe(false);
    expect(await exists(path.join(dir, "com.old.addon.meta"))).toBe(false);
    expect(await exists(path.join(dir, CORE_PKG))).toBe(true);
    expect(await exists(path.join(dir, `${CORE_PKG}.meta`))).toBe(true);
  });

  it("never sweeps the marker file — only DIRECTORIES are scanned", async () => {
    const dir = await importRootWith([CORE_PKG]);

    await reconcileImportRoot(dir, [CORE_PKG]);

    expect(await exists(path.join(dir, ".scvn-mcp.json"))).toBe(true);
    expect(await readdir(dir)).toContain(".scvn-mcp.json");
  });

  it("dry-run reports the orphan but removes nothing", async () => {
    const dir = await importRootWith([CORE_PKG, "com.old.addon"]);

    const removed = await reconcileImportRoot(dir, [CORE_PKG], { dryRun: true });

    expect(removed).toEqual(["com.old.addon"]);
    expect(await exists(path.join(dir, "com.old.addon"))).toBe(true);
  });

  it("no-ops on an import root that does not exist yet", async () => {
    const dir = await tmpDir("scvn-import-");

    await expect(
      reconcileImportRoot(path.join(dir, "missing"), [CORE_PKG]),
    ).resolves.toEqual([]);
  });
});

describe("detectUnityRunning", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reports running when pgrep matches the project path", async () => {
    vi.doMock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 0 })) }));
    const { detectUnityRunning } = await import("../../src/detectors/detect-unity-running.js");

    expect(await detectUnityRunning("/p/game")).toBe(true);
  });

  it("reports not-running when pgrep finds nothing", async () => {
    vi.doMock("execa", () => ({ execa: vi.fn(async () => ({ exitCode: 1 })) }));
    const { detectUnityRunning } = await import("../../src/detectors/detect-unity-running.js");

    expect(await detectUnityRunning("/p/game")).toBe(false);
  });

  it("matches BOTH -projectpath and -projectPath spellings", async () => {
    const execaMock = vi.fn(async () => ({ exitCode: 1 }));
    vi.doMock("execa", () => ({ execa: execaMock }));
    const { detectUnityRunning } = await import("../../src/detectors/detect-unity-running.js");

    await detectUnityRunning("/p/game");

    const patterns = execaMock.mock.calls.map((call) => (call[1] as string[])[1]);
    expect(patterns.some((p) => p?.includes("-projectpath"))).toBe(true);
    expect(patterns.some((p) => p?.includes("-projectPath"))).toBe(true);
  });

  it("treats a missing pgrep as not-running rather than crashing the install", async () => {
    vi.doMock("execa", () => ({
      execa: vi.fn(async () => {
        throw new Error("pgrep not found");
      }),
    }));
    const { detectUnityRunning } = await import("../../src/detectors/detect-unity-running.js");

    expect(await detectUnityRunning("/p/game")).toBe(false);
  });
});
