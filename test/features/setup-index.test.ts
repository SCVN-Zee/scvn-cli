/**
 * test/features/setup-index.test.ts — Unit tests for buildSetupHandlers wiring.
 *
 * Locks the gitignore handler's install-then-prune orchestration and proves the
 * other template ops do NOT prune. The feature functions are mocked; this tests
 * only the handler map, not the underlying template/prune behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const tmplMocks = vi.hoisted(() => ({
  setupTemplate:  vi.fn().mockResolvedValue(undefined),
  setupTemplates: vi.fn().mockResolvedValue(undefined),
}));
const pruneMocks = vi.hoisted(() => ({
  pruneNestedGitignores: vi.fn().mockResolvedValue(undefined),
}));
const untrackMocks = vi.hoisted(() => ({
  untrackIgnoredFiles: vi.fn().mockResolvedValue(undefined),
}));
const toggleMocks = vi.hoisted(() => ({
  toggleSubmoduleIgnore: vi.fn().mockResolvedValue(undefined),
}));
const lfsMocks = vi.hoisted(() => ({
  setupLfs: vi.fn().mockResolvedValue(undefined),
}));
const gitexcludeMocks = vi.hoisted(() => ({
  setupGitexclude: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/setup/setup-templates.js", () => tmplMocks);
vi.mock("../../src/features/setup/prune-nested-gitignores.js", () => pruneMocks);
vi.mock("../../src/features/setup/untrack-ignored-files.js", () => untrackMocks);
vi.mock("../../src/features/setup/toggle-submodule-ignore.js", () => toggleMocks);
vi.mock("../../src/features/setup/setup-lfs.js", () => lfsMocks);
vi.mock("../../src/features/setup/setup-gitexclude.js", () => gitexcludeMocks);

import { buildSetupHandlers } from "../../src/features/setup/index.js";

const reporter = { onStatus() {}, onLog() {} };

beforeEach(() => {
  vi.clearAllMocks();
  tmplMocks.setupTemplate.mockResolvedValue(undefined);
  pruneMocks.pruneNestedGitignores.mockResolvedValue(undefined);
  untrackMocks.untrackIgnoredFiles.mockResolvedValue(undefined);
});

describe("buildSetupHandlers — gitignore", () => {
  it("runs template → prune → untrack in order, threading dryRun/autoYes/reporter/confirms", async () => {
    const pruneConfirm = vi.fn();
    const untrackConfirm = vi.fn();
    await buildSetupHandlers("/repo/Assets", { dryRun: true, autoYes: true, reporter, pruneConfirm, untrackConfirm }).gitignore();

    expect(tmplMocks.setupTemplate).toHaveBeenCalledWith(
      "/repo/Assets", "gitignore", { dryRun: true, reporter },
    );
    expect(pruneMocks.pruneNestedGitignores).toHaveBeenCalledWith(
      "/repo/Assets", { dryRun: true, autoYes: true, reporter, confirmWideScope: pruneConfirm },
    );
    expect(untrackMocks.untrackIgnoredFiles).toHaveBeenCalledWith(
      "/repo/Assets", { dryRun: true, autoYes: true, reporter, confirmWideScope: untrackConfirm },
    );

    // strict order: install BEFORE prune BEFORE untrack
    const installOrder = tmplMocks.setupTemplate.mock.invocationCallOrder[0]!;
    const pruneOrder   = pruneMocks.pruneNestedGitignores.mock.invocationCallOrder[0]!;
    const untrackOrder = untrackMocks.untrackIgnoredFiles.mock.invocationCallOrder[0]!;
    expect(installOrder).toBeLessThan(pruneOrder);
    expect(pruneOrder).toBeLessThan(untrackOrder);
  });
});

describe("buildSetupHandlers — gitexclude", () => {
  it("dispatches to the fenced writer, never the wholesale template copy", async () => {
    await buildSetupHandlers("/repo/Assets", { dryRun: true, autoYes: true, reporter }).gitexclude();

    expect(gitexcludeMocks.setupGitexclude).toHaveBeenCalledWith(
      "/repo/Assets",
      { dryRun: true, reporter },
    );
    expect(tmplMocks.setupTemplate).not.toHaveBeenCalled();
    expect(pruneMocks.pruneNestedGitignores).not.toHaveBeenCalled();
    expect(untrackMocks.untrackIgnoredFiles).not.toHaveBeenCalled();
  });
});

describe("buildSetupHandlers — lfs", () => {
  it("dispatches to setupLfs with target + dryRun/reporter (never installs a template)", async () => {
    await buildSetupHandlers("/repo/Assets", { dryRun: true, autoYes: false, reporter }).lfs();

    // LFS is non-interactive — autoYes is not threaded through.
    expect(lfsMocks.setupLfs).toHaveBeenCalledWith(
      "/repo/Assets",
      { dryRun: true, reporter },
    );
    expect(tmplMocks.setupTemplate).not.toHaveBeenCalled();
    expect(pruneMocks.pruneNestedGitignores).not.toHaveBeenCalled();
    expect(untrackMocks.untrackIgnoredFiles).not.toHaveBeenCalled();
  });
});
