/**
 * test/commands/help-text.test.ts — The help surface is a contract, not prose.
 *
 * Help text drifts silently: a flag gets added, the help forgets it, and the
 * only signal is a user who cannot find the feature. These assertions tie the
 * text to the parser and the dispatch tables, so a new flag that never reaches
 * the help fails here instead of in someone's terminal.
 */

import { describe, it, expect } from "vitest";
import { HELP_TEXT } from "../../src/commands/help-text.js";
import { parseArgv } from "../../src/util/cli-args.js";
import { MCP_USAGE_HINT } from "../../src/commands/mcp.js";

describe("HELP_TEXT — commands", () => {
  it("lists every top-level command", () => {
    for (const command of [
      "packages", "mcp", "fork", "git", "ignore-dirty", "config", "doctor",
    ]) {
      expect(HELP_TEXT).toContain(command);
    }
  });

  it("lists the five mcp verbs", () => {
    for (const verb of ["install", "uninstall", "update", "status", "reconfigure"]) {
      expect(HELP_TEXT).toMatch(new RegExp(`\\b${verb}\\b`));
    }
  });
});

describe("HELP_TEXT — flags match the parser", () => {
  it("documents every flag the parser actually accepts", () => {
    for (const flag of [
      "--dry-run", "--yes", "--from", "--to", "--target", "--store", "--name", "--layout",
      "--addons", "--agent", "--no-tools", "--no-prompts", "--no-resources", "--force",
      "--purge-nuget", "--no-beyond-compare", "--ignore", "--exclude", "--lfs", "--help", "--version",
    ]) {
      expect(HELP_TEXT).toContain(flag);
    }
  });

  it("documents no flag the parser would silently ignore", () => {
    // Only flags in LISTING position (start of an indented line) — a `--local`
    // inside a description like "git lfs install --local" is prose about another
    // tool's flag, not a scvn one.
    const documented = [...HELP_TEXT.matchAll(/^\s+(?:-\w, )?(--[a-z-]+)/gm)].map((m) => m[1]!);
    const unknown = documented.filter((flag) => {
      const parsed = parseArgv([flag, "x"]);
      const known =
        parsed.help || parsed.version || parsed.dryRun || parsed.autoYes ||
        parsed.ignore || parsed.exclude || parsed.lfs || parsed.force || parsed.purgeNuget ||
        parsed.beyondCompare === false ||
        parsed.from !== undefined || parsed.to.length > 0 ||
        parsed.target !== undefined || parsed.store !== undefined ||
        parsed.addons !== undefined || parsed.agent !== undefined ||
        parsed.enableAllTools === false || parsed.enableAllPrompts === false ||
        parsed.enableAllResources === false || parsed.name !== undefined || parsed.layout !== undefined;
      return !known;
    });

    expect(unknown).toEqual([]);
  });
});

describe("MCP_USAGE_HINT", () => {
  it("names every mcp verb, so bare `scvn mcp` is actionable", () => {
    for (const verb of ["status", "install", "uninstall", "update", "reconfigure", "skills", "finish"]) {
      expect(MCP_USAGE_HINT).toContain(verb);
    }
  });

  it("says how to pick a target", () => {
    expect(MCP_USAGE_HINT).toContain("--target");
  });
});
