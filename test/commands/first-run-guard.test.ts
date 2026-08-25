/**
 * test/commands/first-run-guard.test.ts — Unit tests for the startup first-run
 * config guard: the needsProjectsRoot predicate and ensureProjectsRootConfigured.
 *
 * The predicate is precise: it returns false for invocations dispatch will reject
 * as usage errors (unknown verbs, trailing args, bare-noun-under-`-y`) and for the
 * migration-hint namespaces, so those keep their own errors instead of the config
 * hint. The guard is fully dependency-injected (resolveRoot / isDir / runConfig /
 * isTTY / fail / log) so no real TTY, fs, editor, or process.exit is needed.
 */

import { describe, it, expect, vi } from "vitest";
import {
  needsProjectsRoot,
  ensureProjectsRootConfigured,
  type Invocation,
  type GuardDeps,
} from "../../src/commands/first-run-guard.js";
import { MISSING_PROJECTS_ROOT_MESSAGE } from "../../src/commands/shared/project-discovery.js";

function inv(over: Partial<Invocation> = {}): Invocation {
  return {
    namespace: null, subcommands: [], hasFrom: false, hasTo: false, hasTarget: false, autoYes: false,
    ...over,
  };
}

describe("needsProjectsRoot", () => {
  it("packages export needs root unless --from", () => {
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: ["export"] }))).toBe(true);
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: ["export"], hasFrom: true }))).toBe(false);
  });

  it("packages import needs root unless --to", () => {
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: ["import"] }))).toBe(true);
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: ["import"], hasTo: true }))).toBe(false);
  });

  it("bare packages verb menu needs root, except under -y (usage error)", () => {
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: [] }))).toBe(true);
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: [], autoYes: true }))).toBe(false);
  });

  it("unknown noun verb does not need root (dispatch reports usage)", () => {
    expect(needsProjectsRoot(inv({ namespace: "packages", subcommands: ["exprot"] }))).toBe(false);
  });

  it("removed import/export namespaces never need root (dispatch reports unknown command)", () => {
    // `scvn import` / `scvn export` are no longer namespaces — the first positional
    // falls to subcommands and dispatch fails loudly, so the guard must not intercept.
    expect(needsProjectsRoot(inv({ subcommands: ["import"] }))).toBe(false);
    expect(needsProjectsRoot(inv({ subcommands: ["export"] }))).toBe(false);
    expect(needsProjectsRoot(inv({ subcommands: ["import", "all"] }))).toBe(false);
  });

  it("fork never needs root (Fork.app prefs only — no project scan)", () => {
    expect(needsProjectsRoot(inv({ subcommands: ["fork"] }))).toBe(false);
    expect(needsProjectsRoot(inv({ subcommands: ["fork", "extra"] }))).toBe(false);
  });

  it("bootstrap ops need root unless --target / trailing args", () => {
    // gitignore/gitexclude moved to `scvn git` in v0.5 — no longer SETUP_OPS.
    for (const s of ["ignore-dirty"]) {
      expect(needsProjectsRoot(inv({ subcommands: [s] }))).toBe(true);
      expect(needsProjectsRoot(inv({ subcommands: [s], hasTarget: true }))).toBe(false);
      expect(needsProjectsRoot(inv({ subcommands: [s, "extra"] }))).toBe(false);
    }
  });

  it("removed gitignore/gitexclude tokens no longer need root (dispatch → grouping hint)", () => {
    expect(needsProjectsRoot(inv({ subcommands: ["gitignore"] }))).toBe(false);
    expect(needsProjectsRoot(inv({ subcommands: ["gitexclude"] }))).toBe(false);
  });

  it("git needs root only for a real op run (flag set, no --target, single token)", () => {
    // Real op run reaches the picker → needs the root.
    expect(needsProjectsRoot(inv({ subcommands: ["git"], hasGitOp: true }))).toBe(true);
    // Explicit --target short-circuits the picker.
    expect(needsProjectsRoot(inv({ subcommands: ["git"], hasGitOp: true, hasTarget: true }))).toBe(false);
    // Bare `scvn git` (no op flag) prints the hint — never opens the picker.
    expect(needsProjectsRoot(inv({ subcommands: ["git"] }))).toBe(false);
    // Trailing positional is a usage error → dispatch reports it, not the guard.
    expect(needsProjectsRoot(inv({ subcommands: ["git", "extra"], hasGitOp: true }))).toBe(false);
  });

  it("migration-hint namespaces never need root (incl. `setup fork`)", () => {
    expect(needsProjectsRoot(inv({ namespace: "setup", subcommands: ["fork"] }))).toBe(false);
    expect(needsProjectsRoot(inv({ namespace: "sync", subcommands: ["toolkit"] }))).toBe(false);
  });

  it("exempt / unknown commands never need root", () => {
    for (const c of [
      inv({ namespace: "doctor" }),
      inv({ namespace: "config" }),
      inv({ subcommands: ["pack"] }),
      inv({ subcommands: ["pack", "extra"] }),
      inv({ subcommands: ["sycn", "all"] }), // unknown command
      inv(),
    ]) {
      expect(needsProjectsRoot(c)).toBe(false);
    }
  });
});

describe("ensureProjectsRootConfigured", () => {
  const NEEDS: Invocation = {
    namespace: "packages", subcommands: ["export"], hasFrom: false, hasTo: false, hasTarget: false, autoYes: false,
  };

  function mkDeps(over: Partial<GuardDeps> = {}): GuardDeps {
    return {
      resolveRoot: vi.fn(async () => "/configured" as string | null),
      isDir: vi.fn(async () => true),
      runConfig: vi.fn(async () => {}),
      isTTY: true,
      fail: vi.fn((m: string) => {
        throw new Error(m);
      }) as unknown as (m: string) => never,
      log: { step: vi.fn() },
      ...over,
    };
  }

  it("no-ops when the invocation does not need the root", async () => {
    const deps = mkDeps({ resolveRoot: vi.fn(async () => null) });
    await ensureProjectsRootConfigured(inv({ namespace: "doctor" }), deps);
    expect(deps.resolveRoot).not.toHaveBeenCalled();
    expect(deps.runConfig).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("no-ops when config is valid", async () => {
    const deps = mkDeps();
    await ensureProjectsRootConfigured(NEEDS, deps);
    expect(deps.runConfig).not.toHaveBeenCalled();
    expect(deps.fail).not.toHaveBeenCalled();
  });

  it("hard-fails under -y when invalid (no editor launch)", async () => {
    const deps = mkDeps({ resolveRoot: vi.fn(async () => null) });
    await expect(ensureProjectsRootConfigured({ ...NEEDS, autoYes: true }, deps)).rejects.toThrow(MISSING_PROJECTS_ROOT_MESSAGE);
    expect(deps.runConfig).not.toHaveBeenCalled();
  });

  it("hard-fails in non-TTY when invalid", async () => {
    const deps = mkDeps({ resolveRoot: vi.fn(async () => null), isTTY: false });
    await expect(ensureProjectsRootConfigured(NEEDS, deps)).rejects.toThrow(MISSING_PROJECTS_ROOT_MESSAGE);
    expect(deps.runConfig).not.toHaveBeenCalled();
  });

  it("treats a configured-but-non-existent dir as invalid → launches config", async () => {
    const isDir = vi.fn(async () => false);
    isDir.mockResolvedValueOnce(false).mockResolvedValue(true); // dead before, fixed after editing
    const runConfig = vi.fn(async () => {});
    const deps = mkDeps({ resolveRoot: vi.fn(async () => "/dead"), isDir, runConfig });
    await ensureProjectsRootConfigured(NEEDS, deps);
    expect(runConfig).toHaveBeenCalledOnce();
  });

  it("launches scvn config then continues when it becomes valid", async () => {
    const resolveRoot = vi.fn(async () => null as string | null);
    resolveRoot.mockResolvedValueOnce(null).mockResolvedValue("/now/configured");
    const runConfig = vi.fn(async () => {});
    const deps = mkDeps({ resolveRoot, runConfig });
    await ensureProjectsRootConfigured(NEEDS, deps);
    expect(runConfig).toHaveBeenCalledOnce();
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.log.step).toHaveBeenCalled();
  });

  it("launches scvn config then fails if still invalid (no loop)", async () => {
    const resolveRoot = vi.fn(async () => null); // never becomes valid
    const runConfig = vi.fn(async () => {});
    const deps = mkDeps({ resolveRoot, runConfig });
    await expect(ensureProjectsRootConfigured(NEEDS, deps)).rejects.toThrow(/still not usable/);
    expect(runConfig).toHaveBeenCalledOnce();
  });
});

describe("needsProjectsRoot — mcp", () => {
  it("status always needs the root — it enumerates every project", () => {
    expect(needsProjectsRoot(inv({ namespace: "mcp", subcommands: ["status"] }))).toBe(true);
  });

  it("status needs the root even under -y (there is no explicit path to pass instead)", () => {
    expect(
      needsProjectsRoot(inv({ namespace: "mcp", subcommands: ["status"], autoYes: true })),
    ).toBe(true);
  });

  it("the mutating verbs need the root only when they would reach the picker", () => {
    for (const verb of ["install", "uninstall", "update"]) {
      expect(needsProjectsRoot(inv({ namespace: "mcp", subcommands: [verb] }))).toBe(true);
      expect(
        needsProjectsRoot(inv({ namespace: "mcp", subcommands: [verb], hasTarget: true })),
      ).toBe(false);
    }
  });

  it("bare `scvn mcp` does not need the root — dispatch prints the usage hint", () => {
    expect(needsProjectsRoot(inv({ namespace: "mcp", subcommands: [] }))).toBe(false);
  });

  it("an unknown mcp verb does not need the root — dispatch reports the usage error", () => {
    expect(needsProjectsRoot(inv({ namespace: "mcp", subcommands: ["instal"] }))).toBe(false);
  });
});
