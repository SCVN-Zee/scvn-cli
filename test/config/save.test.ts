/**
 * test/config/save.test.ts — Unit tests for config/save.ts
 *
 * Tests:
 *   - Writes correct SCVN_* KEY=value content
 *   - File permissions are 0o600
 *   - Atomic: no partial file left when target is a directory (rename fails)
 *   - Idempotent: second save overwrites cleanly
 *   - quoteShell helper handles edge cases
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, stat, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig, quoteShell } from "../../src/config/save.js";
import type { ScvnConfig } from "../../src/config/types.js";

// ---------------------------------------------------------------------------
// quoteShell unit tests
// ---------------------------------------------------------------------------

describe("quoteShell", () => {
  it("returns safe chars unquoted", () => {
    expect(quoteShell("/vol/projects")).toBe("/vol/projects");
    expect(quoteShell("github.com")).toBe("github.com");
    expect(quoteShell("my-host_1.example.com:8080")).toBe("my-host_1.example.com:8080");
  });

  it("wraps empty string as two single quotes", () => {
    expect(quoteShell("")).toBe("''");
  });

  it("single-quotes strings with spaces", () => {
    expect(quoteShell("/my path/with spaces")).toBe("'/my path/with spaces'");
  });

  it("escapes embedded single quotes as '\\''", () => {
    expect(quoteShell("it's here")).toBe("'it'\\''s here'");
  });
});

// ---------------------------------------------------------------------------
// saveConfig filesystem tests
// ---------------------------------------------------------------------------

describe("saveConfig", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `scvn-save-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    configPath = join(tmpDir, "config");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes present fields as SCVN_* KEY=value", async () => {
    const cfg: ScvnConfig = {
      projectsRoot: "/vol/projects",
    };
    await saveConfig(cfg, { configPath });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("SCVN_PROJECTS_ROOT=/vol/projects");
  });

  it("omits undefined fields (no KEY=value lines for absent fields)", async () => {
    const cfg: ScvnConfig = {};
    await saveConfig(cfg, { configPath });

    const content = await readFile(configPath, "utf8");
    // Empty config → header comment block only, no assignment line
    expect(content).not.toMatch(/^SCVN_PROJECTS_ROOT=/m);
  });

  it("writes with mode 0o600", async () => {
    await saveConfig({ projectsRoot: "/vol/p" }, { configPath });

    const info = await stat(configPath);
    // Extract lower 9 permission bits
    const mode = info.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("includes header comment block", async () => {
    await saveConfig({}, { configPath });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain("# scvn config");
    expect(content).toContain("SCVN_PROJECTS_ROOT");
    expect(content).not.toContain("SCVN_FORK_LAST_UNITY");
  });

  it("is idempotent: second save overwrites with same content", async () => {
    const cfg: ScvnConfig = { projectsRoot: "/vol/p" };
    await saveConfig(cfg, { configPath });
    const first = await readFile(configPath, "utf8");

    await saveConfig(cfg, { configPath });
    const second = await readFile(configPath, "utf8");

    expect(second).toBe(first);
  });

  it("atomic: no .tmp file left after successful write", async () => {
    await saveConfig({ projectsRoot: "/vol/p" }, { configPath });

    // Temp file must be cleaned up after rename
    await expect(stat(`${configPath}.tmp`)).rejects.toThrow();
  });

  it("atomic: no partial config written when rename would fail (target is dir)", async () => {
    // Force rename to fail: make the target path a directory
    // The .tmp file should be cleaned up or not persist as partial output
    await mkdir(configPath, { recursive: true });

    await expect(saveConfig({ projectsRoot: "/vol/p" }, { configPath })).rejects.toThrow();

    // Original directory should still exist (we didn't corrupt it)
    const info = await stat(configPath);
    expect(info.isDirectory()).toBe(true);
  });

  it("creates parent directory if absent", async () => {
    const deepPath = join(tmpDir, "nested", "dir", "config");
    await saveConfig({ projectsRoot: "/vol/p" }, { configPath: deepPath });

    const content = await readFile(deepPath, "utf8");
    expect(content).toContain("SCVN_PROJECTS_ROOT=/vol/p");
  });
});
