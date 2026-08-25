/**
 * test/config/migrate.test.ts — Unit tests for config/migrate.ts
 *
 * Tests:
 *   - ~/.config/scvn → ~/.scvn copy (config, history)
 *   - Legacy sync-unity source → correct keys in scvn config
 *   - Idempotent: second run is a no-op (scvn config already exists)
 *   - Skipped entirely when scvn config already exists
 *   - Empty legacy config → nothing written
 *   - Never throws on missing files or bad data
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../src/config/migrate.js";
import { parseConfigText } from "../../src/config/load.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TmpPaths {
  // New ~/.scvn/* destination paths
  configPath:       string;
  historyPath:      string;
  // Previous scvn dir ~/.config/scvn (parent — files written by tests)
  previousScvnDir:  string;
  // Legacy source
  legacyConfigPath: string;
}

async function makeTmpDirs(): Promise<{ root: string; paths: TmpPaths }> {
  const root = join(tmpdir(), `scvn-migrate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const scvnDir       = join(root, "scvn");           // ~/.scvn
  const prevScvnDir   = join(root, "config-scvn");    // ~/.config/scvn
  const legacyDir     = join(root, "sync-unity");     // ~/.config/sync-unity

  await mkdir(scvnDir,     { recursive: true });
  await mkdir(prevScvnDir, { recursive: true });
  await mkdir(legacyDir,   { recursive: true });

  return {
    root,
    paths: {
      configPath:       join(scvnDir,   "config"),
      historyPath:      join(scvnDir,   "history.jsonl"),
      previousScvnDir:  prevScvnDir,
      legacyConfigPath: join(legacyDir, "config"),
    },
  };
}

async function readParsed(configPath: string): Promise<Record<string, string>> {
  const raw = await readFile(configPath, "utf8");
  return parseConfigText(raw);
}

// Suppress migrate's stderr output in all tests
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("migrate", () => {
  let root: string;
  let paths: TmpPaths;

  beforeEach(async () => {
    ({ root, paths } = await makeTmpDirs());
    stderrSpy.mockClear();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("migrates known keys from sync-unity config (drops the removed SSH_HOST)", async () => {
    await writeFile(paths.legacyConfigPath, [
      "SYNC_UNITY_PROJECTS_ROOT=/vol/projects",
      "SYNC_UNITY_SSH_HOST=github.com",
    ].join("\n") + "\n", "utf8");

    await migrate(paths);

    const parsed = await readParsed(paths.configPath);
    expect(parsed["SCVN_PROJECTS_ROOT"]).toBe("/vol/projects");
    expect(parsed["SCVN_SSH_HOST"]).toBeUndefined();
  });

  it("is idempotent: second run does not overwrite existing scvn config", async () => {
    await writeFile(paths.legacyConfigPath,
      "SYNC_UNITY_PROJECTS_ROOT=/vol/projects\n", "utf8");

    await migrate(paths);
    const afterFirst = await readFile(paths.configPath, "utf8");

    // Change legacy config — second run must ignore it
    await writeFile(paths.legacyConfigPath,
      "SYNC_UNITY_PROJECTS_ROOT=/vol/CHANGED\n", "utf8");

    await migrate(paths);
    const afterSecond = await readFile(paths.configPath, "utf8");

    expect(afterSecond).toBe(afterFirst);
  });

  it("skips entirely when scvn config already exists", async () => {
    const existing = "SCVN_PROJECTS_ROOT=/already/set\n";
    await writeFile(paths.configPath, existing, "utf8");

    await writeFile(paths.legacyConfigPath,
      "SYNC_UNITY_PROJECTS_ROOT=/should/not/appear\n", "utf8");

    await migrate(paths);

    const content = await readFile(paths.configPath, "utf8");
    expect(content).toBe(existing);
  });

  it("writes nothing when the legacy source is absent", async () => {
    await migrate(paths);

    // scvn config should NOT be created when nothing to migrate
    await expect(readFile(paths.configPath, "utf8")).rejects.toThrow();
  });

  it("does not throw when legacy config has unrecognized keys", async () => {
    await writeFile(paths.legacyConfigPath, [
      "SYNC_UNITY_PROJECTS_ROOT=/vol/projects",
      "UNKNOWN_KEY=whatever",
    ].join("\n") + "\n", "utf8");

    await expect(migrate(paths)).resolves.toBeUndefined();

    const parsed = await readParsed(paths.configPath);
    expect(parsed["SCVN_PROJECTS_ROOT"]).toBe("/vol/projects");
    expect(parsed["UNKNOWN_KEY"]).toBeUndefined();
  });

  it("never throws even when paths are completely invalid", async () => {
    const badPaths = {
      configPath:       "/nonexistent/deeply/nested/scvn/config",
      historyPath:      "/nonexistent/scvn/history.jsonl",
      previousScvnDir:  "/nonexistent/config-scvn",
      legacyConfigPath: "/nonexistent/sync-unity/config",
    };

    // Should resolve (not reject) — best-effort
    await expect(migrate(badPaths)).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // ~/.config/scvn → ~/.scvn copy step
  // -------------------------------------------------------------------------

  describe("previous scvn dir copy", () => {
    it("copies config and history from ~/.config/scvn", async () => {
      const prevConfig  = "SCVN_PROJECTS_ROOT=/already/migrated\n";
      const prevHistory = `{"ts":"2024-01-01T00:00:00Z","kind":"sync","status":"ok"}\n`;

      await writeFile(join(paths.previousScvnDir, "config"),        prevConfig,  "utf8");
      await writeFile(join(paths.previousScvnDir, "history.jsonl"), prevHistory, "utf8");

      await migrate(paths);

      // Both files copied verbatim
      expect(await readFile(paths.configPath,  "utf8")).toBe(prevConfig);
      expect(await readFile(paths.historyPath, "utf8")).toBe(prevHistory);

      // Originals NOT deleted (non-destructive)
      expect(await readFile(join(paths.previousScvnDir, "config"),        "utf8")).toBe(prevConfig);
      expect(await readFile(join(paths.previousScvnDir, "history.jsonl"), "utf8")).toBe(prevHistory);
    });

    it("copies only files that exist in ~/.config/scvn", async () => {
      // Only config present — history absent
      const prevConfig = "SCVN_PROJECTS_ROOT=/from/prev\n";
      await writeFile(join(paths.previousScvnDir, "config"), prevConfig, "utf8");

      await migrate(paths);

      expect(await readFile(paths.configPath, "utf8")).toBe(prevConfig);
      await expect(readFile(paths.historyPath, "utf8")).rejects.toThrow();
    });

    it("does not copy when ~/.scvn/config already exists", async () => {
      const existing = "SCVN_PROJECTS_ROOT=/already/here\n";
      await writeFile(paths.configPath, existing, "utf8");

      await writeFile(join(paths.previousScvnDir, "config"),
        "SCVN_PROJECTS_ROOT=/should/not/override\n", "utf8");

      await migrate(paths);

      expect(await readFile(paths.configPath, "utf8")).toBe(existing);
    });

    it("prefers prev-dir copy over legacy sync-unity migration", async () => {
      // Both sources present — prev scvn dir wins
      await writeFile(join(paths.previousScvnDir, "config"),
        "SCVN_PROJECTS_ROOT=/from/prev-scvn\n", "utf8");
      await writeFile(paths.legacyConfigPath,
        "SYNC_UNITY_PROJECTS_ROOT=/from/sync-unity\n", "utf8");

      await migrate(paths);

      const parsed = await readParsed(paths.configPath);
      expect(parsed["SCVN_PROJECTS_ROOT"]).toBe("/from/prev-scvn");
    });
  });
});
