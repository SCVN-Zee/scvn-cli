import { describe, it, expect } from "vitest";
import { execa } from "execa";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../bin/scvn");

describe("scvn smoke", () => {
  it("prints version", async () => {
    const { stdout, exitCode } = await execa(BIN, ["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("0.5.0");
  });

  it("prints help with -h", async () => {
    const { stdout, exitCode } = await execa(BIN, ["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("scvn");
    expect(stdout).toContain("Usage:");
  });

  it("help documents the grammar (packages noun + direct ops + git group)", async () => {
    const { stdout } = await execa(BIN, ["-h"]);
    for (const token of [
      "packages",
      "fork", "git", "ignore-dirty",
      "--ignore", "--exclude", "--lfs",
      "--from", "--to", "--target",
    ]) {
      expect(stdout).toContain(token);
    }
    // toolkit was removed — its noun must not appear anywhere in help.
    expect(stdout).not.toContain("toolkit");
    expect(stdout).not.toContain("sync subcommands");
    expect(stdout).not.toContain("setup subcommands");
  });

  it("scvn setup <anything> exits 1 with the v0.3 migration table", async () => {
    const { stderr, exitCode } = await execa(BIN, ["setup", "fork"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("scvn setup was replaced in v0.3");
    expect(stderr).toContain("scvn setup fork");
  });

  it("direct op with trailing arguments exits 1 (no silent partial bootstrap)", async () => {
    const { stderr, exitCode } = await execa(
      BIN,
      ["ignore-dirty", "extra", "--target", "/tmp/x", "-y"],
      { reject: false },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unexpected argument: extra");
  });

  it("scvn git (bare, no flag) exits 1 with the op-flag hint", async () => {
    const { stderr, exitCode } = await execa(BIN, ["git"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("needs at least one op flag");
  });

  it("scvn git with a positional exits 1 (ops are flags, not positionals)", async () => {
    const { stderr, exitCode } = await execa(BIN, ["git", "ignore"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unexpected argument: ignore");
  });

  it("removed scvn gitignore / gitexclude exit 1 with the v0.5 grouping hint", async () => {
    for (const cmd of ["gitignore", "gitexclude"]) {
      const { stderr, exitCode } = await execa(BIN, [cmd], { reject: false });
      expect(exitCode).toBe(1);
      expect(stderr).toContain("grouped into scvn git");
    }
  });

  it("fork with trailing arguments exits 1", async () => {
    const { stderr, exitCode } = await execa(BIN, ["fork", "extra"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unexpected argument: extra");
  });

  it("pack is no longer a command — `scvn pack` exits 1 (bundling moved to `make pack`)", async () => {
    const { stderr, exitCode } = await execa(BIN, ["pack"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command: pack");
  });

  it("scvn sync <anything> exits 1 with the migration table", async () => {
    const { stderr, exitCode } = await execa(BIN, ["sync", "toolkit"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("scvn sync was replaced in v0.2");
    expect(stderr).toContain("scvn sync toolkit   → removed");
    expect(stderr).toContain("scvn sync packages  → scvn packages export +  scvn packages import");
    expect(stderr).toContain("scvn sync mcp       → removed");
    expect(stderr).toContain("scvn sync all       → scvn packages import");
  });

  it("bare scvn all exits 1 with the migration table", async () => {
    const { stderr, exitCode } = await execa(BIN, ["all"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("scvn sync was replaced in v0.2");
  });

  it("unknown noun verb exits 1 with usage", async () => {
    const { stderr, exitCode } = await execa(BIN, ["packages", "exprot"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown packages subcommand: exprot");
    expect(stderr).toContain("scvn packages [add|remove|import|export]");
  });

  it("unknown command exits 1 (typo'd noun must not look like success)", async () => {
    const { stderr, exitCode } = await execa(BIN, ["sycn", "all"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command: sycn");
  });

  it("removed commands (toolkit / import / export) exit 1 as unknown", async () => {
    for (const cmd of ["toolkit", "import", "export"]) {
      const { stderr, exitCode } = await execa(BIN, [cmd], { reject: false });
      expect(exitCode).toBe(1);
      expect(stderr).toContain(`Unknown command: ${cmd}`);
    }
  });

  it("-y without a verb on a noun exits 1 (no silent menu cancel)", async () => {
    const { stderr, exitCode } = await execa(BIN, ["packages", "-y"], { reject: false });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--yes requires an explicit verb");
  });
});
