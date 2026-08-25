/**
 * test/util/direct-ops-routing.test.ts — Verify cli.tsx wires the v0.3
 * direct-command dispatch: bootstrap ops and fork are top-level commands,
 * the setup namespace is a migration-hint stub that exits 1.
 *
 * Reads source files and asserts structural strings exist. Avoids spawning a
 * subprocess. The hint module itself is imported directly (pure module).
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SETUP_MIGRATION_HINT } from "../../src/commands/setup-migration-hint.js";
import { GIT_GROUPING_HINT } from "../../src/commands/git-migration-hint.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const CLI_PATH   = path.join(__dirname, "..", "..", "src", "cli.tsx");
const FORK_PATH  = path.join(__dirname, "..", "..", "src", "commands", "fork.ts");
const GUARD_PATH = path.join(__dirname, "..", "..", "src", "commands", "first-run-guard.ts");

async function readCli(): Promise<string> {
  return readFile(CLI_PATH, "utf8");
}

async function readFork(): Promise<string> {
  return readFile(FORK_PATH, "utf8");
}

async function readGuard(): Promise<string> {
  return readFile(GUARD_PATH, "utf8");
}

describe("cli.tsx — v0.3 direct-op dispatch", () => {
  it("declares SETUP_OPS with exactly the 1 remaining bootstrap op", async () => {
    // SETUP_OPS is single-sourced in the first-run guard (also used by the guard
    // predicate); cli.tsx imports and uses it for dispatch. gitignore/gitexclude
    // were grouped into `scvn git` in v0.5 — no longer op-set members.
    const guard = await readGuard();
    expect(guard).toMatch(/SETUP_OPS\s*:\s*Record<string,\s*true>/);
    for (const key of ["ignore-dirty"]) {
      expect(guard).toContain(`"${key}"`);
    }
    expect(guard).not.toContain(`"gitignore"`);
    expect(guard).not.toContain(`"gitexclude"`);
    const src = await readCli();
    expect(src).toMatch(/SETUP_OPS\[firstSub\]/);
    // The v0.2 shorthand set is gone — and fork/all are not op-set members
    expect(guard).not.toMatch(/SETUP_SUBCOMMANDS/);
  });

  it("routes fork to runFork, ops to runSetupOp, and git to runGitCommand", async () => {
    const src = await readCli();
    expect(src).toMatch(/runFork/);
    expect(src).toMatch(/runSetupOp/);
    expect(src).toMatch(/firstSub === "git"/);
    expect(src).toMatch(/runGitCommand/);
    // The menu-driven runSetup entry no longer exists anywhere in routing
    expect(src).not.toMatch(/\brunSetup\(/);
    expect(src).not.toMatch(/\brunSetup\b(?!Op)/);
  });

  it("routes removed gitignore/gitexclude tokens to the git grouping hint (exit 1)", async () => {
    const src = await readCli();
    expect(src).toMatch(/firstSub === "gitignore" \|\| firstSub === "gitexclude"/);
    expect(src).toMatch(/printGitGroupingHint/);
  });

  it("setup namespace prints the migration hint and exits 1", async () => {
    const src = await readCli();
    expect(src).toMatch(/effectiveNamespace\s*===\s*["']setup["']/);
    expect(src).toMatch(/printSetupMigrationHint/);
  });

  it("fork dispatch warns when --target is passed", async () => {
    const src = await readCli();
    expect(src).toContain("--target is ignored");
  });

  it("sync migration stub remains wired (v0.2 cutover unchanged)", async () => {
    const src = await readCli();
    expect(src).not.toMatch(/SYNC_SUBCOMMANDS/);
    expect(src).toMatch(/printSyncMigrationHint/);
  });
});

describe("setup-migration-hint — old → new command table", () => {
  it("maps every old setup subcommand to its direct command", () => {
    expect(SETUP_MIGRATION_HINT).toContain("scvn ignore-dirty");
    expect(SETUP_MIGRATION_HINT).toContain("scvn git --ignore");   // gitignore grouped into `scvn git`
    expect(SETUP_MIGRATION_HINT).toContain("scvn git --exclude");  // gitexclude grouped into `scvn git`
    expect(SETUP_MIGRATION_HINT).toContain("scvn fork");
  });

  it("marks the run-all op as removed", () => {
    expect(SETUP_MIGRATION_HINT).toMatch(/all.*removed/i);
  });
});

describe("git-migration-hint — v0.4 → v0.5 grouping table", () => {
  it("maps gitignore/gitexclude to the new git flags", () => {
    expect(GIT_GROUPING_HINT).toContain("scvn gitignore");
    expect(GIT_GROUPING_HINT).toContain("scvn git --ignore");
    expect(GIT_GROUPING_HINT).toContain("scvn gitexclude");
    expect(GIT_GROUPING_HINT).toContain("scvn git --exclude");
  });
});

describe("commands/fork.ts — direct-command strings", () => {
  it("has the macOS guard naming the direct command (scvn fork)", async () => {
    const fork = await readFork();
    expect(fork).toMatch(/process\.platform\s*!==\s*["']darwin["']/);
    expect(fork).toMatch(/scvn fork.*macOS only/);
    expect(fork).not.toContain("scvn setup fork");
  });
});
