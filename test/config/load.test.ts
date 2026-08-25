/**
 * test/config/load.test.ts — Unit tests for config/load.ts
 *
 * Tests:
 *   - parseConfigText: comments, blank lines, quoted values, first-= split
 *   - loadConfig: file values, SCVN_* env override, SYNC_UNITY_* fallback precedence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfigText, loadConfig } from "../../src/config/load.js";

// ---------------------------------------------------------------------------
// parseConfigText unit tests
//
// parseConfigText is a generic KEY=value parser — it does not care whether a
// key maps to a ScvnConfig field. SCVN_EXTRA is used as a neutral fixture key
// (any uppercase key is returned verbatim).
// ---------------------------------------------------------------------------

describe("parseConfigText", () => {
  it("parses simple KEY=value pairs", () => {
    const raw = "SCVN_PROJECTS_ROOT=/vol/projects\nSCVN_EXTRA=/vol/projects/GameA\n";
    const result = parseConfigText(raw);
    expect(result["SCVN_PROJECTS_ROOT"]).toBe("/vol/projects");
    expect(result["SCVN_EXTRA"]).toBe("/vol/projects/GameA");
  });

  it("skips comment lines starting with #", () => {
    const raw = "# this is a comment\nSCVN_EXTRA=/g\n# another comment\n";
    const result = parseConfigText(raw);
    expect(Object.keys(result)).toEqual(["SCVN_EXTRA"]);
  });

  it("skips blank and whitespace-only lines", () => {
    const raw = "\n  \nSCVN_EXTRA=/g\n\n";
    const result = parseConfigText(raw);
    expect(Object.keys(result)).toEqual(["SCVN_EXTRA"]);
  });

  it("handles single-quoted values", () => {
    const raw = "SCVN_PROJECTS_ROOT='/vol/my projects/unity'\n";
    const result = parseConfigText(raw);
    expect(result["SCVN_PROJECTS_ROOT"]).toBe("/vol/my projects/unity");
  });

  it("handles single-quoted values with embedded single-quote escape", () => {
    // bash %q produces: 'it'\''s here'
    const raw = "SCVN_PROJECTS_ROOT='it'\\''s here'\n";
    const result = parseConfigText(raw);
    expect(result["SCVN_PROJECTS_ROOT"]).toBe("it's here");
  });

  it("handles double-quoted values", () => {
    const raw = 'SCVN_PROJECTS_ROOT="/my path"\n';
    const result = parseConfigText(raw);
    expect(result["SCVN_PROJECTS_ROOT"]).toBe("/my path");
  });

  it("splits on first = only (value may contain =)", () => {
    const raw = "SCVN_PROJECTS_ROOT=/path/with=equals/inside\n";
    const result = parseConfigText(raw);
    expect(result["SCVN_PROJECTS_ROOT"]).toBe("/path/with=equals/inside");
  });

  it("skips lines with lowercase keys", () => {
    const raw = "lowercase_key=value\nSCVN_EXTRA=/g\n";
    const result = parseConfigText(raw);
    expect(Object.keys(result)).toEqual(["SCVN_EXTRA"]);
  });

  it("skips lines with no = sign", () => {
    const raw = "BADLINE\nSCVN_EXTRA=/g\n";
    const result = parseConfigText(raw);
    expect(Object.keys(result)).toEqual(["SCVN_EXTRA"]);
  });

  it("returns empty object for empty string", () => {
    expect(parseConfigText("")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// loadConfig integration tests (filesystem + env)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tmpDir: string;
  let configPath: string;

  // Save and restore env around each test
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `scvn-load-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    configPath = join(tmpDir, "config");

    savedEnv = { ...process.env };
    // Clear all relevant env vars
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("SCVN_") || k.startsWith("SYNC_UNITY_")) {
        delete process.env[k];
      }
    }
  });

  afterEach(async () => {
    // Restore env
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("SCVN_") || k.startsWith("SYNC_UNITY_")) {
        delete process.env[k];
      }
    }
    Object.assign(process.env, savedEnv);

    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty config when file absent and no env", async () => {
    const cfg = await loadConfig({ configPath });
    expect(cfg).toEqual({});
  });

  it("reads projectsRoot from config file", async () => {
    await writeFile(configPath, [
      "# header",
      "SCVN_PROJECTS_ROOT=/vol/projects",
    ].join("\n") + "\n", "utf8");

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/vol/projects");
  });

  it("ignores the removed SCVN_FORK_LAST_UNITY key (self-cleaning migration)", async () => {
    await writeFile(configPath, [
      "SCVN_PROJECTS_ROOT=/vol/projects",
      "SCVN_FORK_LAST_UNITY=/vol/projects/GameA",
    ].join("\n") + "\n", "utf8");

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/vol/projects");
    expect("forkLastUnity" in cfg).toBe(false);
  });

  it("ignores the removed SCVN_SSH_HOST key", async () => {
    await writeFile(configPath, [
      "SCVN_PROJECTS_ROOT=/vol/projects",
      "SCVN_SSH_HOST=github.com",
    ].join("\n") + "\n", "utf8");

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/vol/projects");
    expect("sshHost" in cfg).toBe(false);
  });

  it("SCVN_* env overrides file value", async () => {
    await writeFile(configPath, "SCVN_PROJECTS_ROOT=/from/file\n", "utf8");
    process.env["SCVN_PROJECTS_ROOT"] = "/from/env";

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/from/env");
  });

  it("SCVN_* env sets value even when file absent", async () => {
    process.env["SCVN_PROJECTS_ROOT"] = "/env/root";

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/env/root");
  });

  it("legacy SYNC_UNITY_* fallback fills field when SCVN equivalent absent", async () => {
    // Suppress stderr for this test (deprecation warning)
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.env["SYNC_UNITY_PROJECTS_ROOT"] = "/legacy/root";

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/legacy/root");

    vi.restoreAllMocks();
  });

  it("legacy SYNC_UNITY_* does NOT override SCVN_* env", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    process.env["SCVN_PROJECTS_ROOT"]       = "/current/root";
    process.env["SYNC_UNITY_PROJECTS_ROOT"] = "/legacy/root";

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/current/root");

    vi.restoreAllMocks();
  });

  it("legacy SYNC_UNITY_* does NOT override file value", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await writeFile(configPath, "SCVN_PROJECTS_ROOT=/from/file\n", "utf8");
    process.env["SYNC_UNITY_PROJECTS_ROOT"] = "/legacy/root";

    const cfg = await loadConfig({ configPath });
    expect(cfg.projectsRoot).toBe("/from/file");

    vi.restoreAllMocks();
  });
});
