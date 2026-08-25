/**
 * test/commands/config.test.ts — Unit tests for commands/config.ts
 *
 * Drives runConfig() with a fakePrompt, an injected isDir predicate, and a temp
 * config path so no real TTY, editor, or ~/.scvn/config is touched.
 *
 * Scenarios:
 *   (a) TTY: prompts the root, validates the dir, writes SCVN_PROJECTS_ROOT
 *   (b) TTY: expands ~ before saving
 *   (c) TTY: re-prompts until the path is an existing directory
 *   (d) non-TTY: seeds the file when missing, prints path, no prompt, exit 0
 *   (e) non-TTY: existing file left intact, no prompt
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runConfig, runConfigExecute } from "../../src/commands/config.js";
import { fakePrompt } from "../../src/ui/prompt.js";

// ---------------------------------------------------------------------------
// Suppress clack output (writes to process.stdout/stderr) + control TTY
// ---------------------------------------------------------------------------

let stdoutWrite: typeof process.stdout.write;
let stderrWrite: typeof process.stderr.write;
let savedIsTTY: boolean | undefined;

beforeEach(() => {
  stdoutWrite = process.stdout.write.bind(process.stdout);
  stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  savedIsTTY = process.stdin.isTTY;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = stdoutWrite;
  process.stderr.write = stderrWrite;
  Object.defineProperty(process.stdin, "isTTY", {
    value: savedIsTTY,
    writable: true,
    configurable: true,
  });
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    writable: true,
    configurable: true,
  });
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "scvn-config-test-"));
}

function textCalls(prompt: { calls: Array<{ type: string }> }): number {
  return prompt.calls.filter((c) => c.type === "text").length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runConfig() — interactive prompt", () => {

  it("(a) TTY: prompts root, validates dir, writes SCVN_PROJECTS_ROOT", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    await writeFile(configPath, "SCVN_PROJECTS_ROOT=/old/root\n", "utf8");
    setTTY(true);

    const prompt = fakePrompt(["/valid/projects"]);
    const isDir = async (p: string) => p === "/valid/projects";

    await runConfig({ prompt, isDir, configPath });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("SCVN_PROJECTS_ROOT=/valid/projects");
    expect(textCalls(prompt)).toBe(1);
    expect(process.exitCode).toBeUndefined();

    await rm(dir, { recursive: true });
  });

  it("(b) TTY: expands ~ before saving", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    setTTY(true);

    const expanded = path.join(os.homedir(), "Projects");
    const prompt = fakePrompt(["~/Projects"]);
    const isDir = async (p: string) => p === expanded;

    await runConfig({ prompt, isDir, configPath });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain(`SCVN_PROJECTS_ROOT=${expanded}`);

    await rm(dir, { recursive: true });
  });

  it("(c) TTY: re-prompts until the path is an existing directory", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    setTTY(true);

    const prompt = fakePrompt(["/does/not/exist", "/good/root"]);
    const seen: string[] = [];
    const isDir = async (p: string) => {
      seen.push(p);
      return p === "/good/root";
    };

    await runConfig({ prompt, isDir, configPath });

    expect(textCalls(prompt)).toBe(2);
    expect(seen).toEqual(["/does/not/exist", "/good/root"]);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("SCVN_PROJECTS_ROOT=/good/root");

    await rm(dir, { recursive: true });
  });

  it("(d) non-TTY: seeds file when missing, prints path, no prompt, exit 0", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    setTTY(false);

    const prompt = fakePrompt([]);
    await runConfig({ prompt, configPath });

    expect(prompt.calls).toHaveLength(0);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("scvn config"); // seeded header
    expect(process.exitCode).toBeUndefined();

    await rm(dir, { recursive: true });
  });

  it("(e) non-TTY: existing file left intact, no prompt", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    await writeFile(configPath, "SCVN_PROJECTS_ROOT=/keep/me\n", "utf8");
    setTTY(false);

    const prompt = fakePrompt([]);
    await runConfig({ prompt, configPath });

    expect(prompt.calls).toHaveLength(0);
    const content = await readFile(configPath, "utf8");
    expect(content).toContain("/keep/me");
    expect(process.exitCode).toBeUndefined();

    await rm(dir, { recursive: true });
  });
});

describe("runConfigExecute() — GUI form write half", () => {
  it("valid dir: writes SCVN_PROJECTS_ROOT and returns ok", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    const isDir = async (p: string) => p === "/valid/projects";

    const result = await runConfigExecute({ projectsRoot: "/valid/projects" }, { configPath, isDir });
    expect(result.ok).toBe(true);
    expect(await readFile(configPath, "utf8")).toContain("SCVN_PROJECTS_ROOT=/valid/projects");

    await rm(dir, { recursive: true });
  });

  it("expands ~ before validating and saving", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    const home = os.homedir();
    const isDir = async (p: string) => p === home;

    const result = await runConfigExecute({ projectsRoot: "~" }, { configPath, isDir });
    expect(result.ok).toBe(true);
    expect(await readFile(configPath, "utf8")).toContain(`SCVN_PROJECTS_ROOT=${home}`);

    await rm(dir, { recursive: true });
  });

  it("non-existent dir: returns ok:false and does not write the root", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");
    const isDir = async () => false;

    const result = await runConfigExecute({ projectsRoot: "/does/not/exist" }, { configPath, isDir });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not an existing directory/);
    await expect(readFile(configPath, "utf8")).rejects.toThrow(); // never created

    await rm(dir, { recursive: true });
  });

  it("empty path: returns ok:false with a required-path error", async () => {
    const dir = await makeTempDir();
    const configPath = path.join(dir, "config");

    const result = await runConfigExecute({ projectsRoot: "   " }, { configPath, isDir: async () => true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Path is required/);

    await rm(dir, { recursive: true });
  });
});
