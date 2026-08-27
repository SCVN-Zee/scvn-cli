/**
 * test/desktop/fork-host.test.ts — The desktop `fork` handler's failure guard.
 *
 * When the Fork half fails (quit timeout, write error) the optional
 * git-side `.gitattributes` half must NOT run: the user's Apply consented
 * to a completed Fork setup, and a quit-timeout abort means nothing was
 * written at all.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { forkMocks, mergeMocks } = vi.hoisted(() => ({
  forkMocks: {
    forkPreflight: vi.fn(),
    forkExecute:   vi.fn(),
  },
  mergeMocks: {
    setupMergeAttributes: vi.fn(),
  },
}));

vi.mock("../../src/commands/fork.js", () => ({
  forkPreflight: forkMocks.forkPreflight,
  forkExecute:   forkMocks.forkExecute,
}));
vi.mock("../../src/features/setup/setup-merge-attributes.js", () => ({
  setupMergeAttributes: mergeMocks.setupMergeAttributes,
}));

import { capabilities } from "../../desktop/host/capabilities.js";
import type { HostSession } from "../../desktop/host/session.js";

const UNITY = [{
  editorPath:    "/Applications/Unity/Hub/Editor/6000.0.1f1/Unity.app",
  version:       "6000.0.1f1",
  yamlMergePath: "/Applications/Unity/Hub/Editor/6000.0.1f1/Unity.app/Contents/Tools/UnityYAMLMerge",
}];

/** Minimal session stub — only emitOutput is reached in these flows. */
function stubSession(): HostSession {
  return { emitOutput: vi.fn() } as unknown as HostSession;
}

describe("fork host handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forkMocks.forkPreflight.mockResolvedValue({
      ok: true,
      blocker: null,
      spinnerLabel: null,
      forkRunning: false,
      beyondComparePath: null,
      unityVersions: UNITY,
    });
  });

  it("fork half fails (quit timeout) → merge attributes skipped, failure returned", async () => {
    forkMocks.forkExecute.mockResolvedValue({ ok: false, error: "Fork did not quit in time — quit Fork manually and re-run." });

    const result = (await capabilities.fork(stubSession(), {
      setupBeyondCompare:   false,
      applyMergeAttributes: true,
      mergeTarget:          "/tmp/proj",
    })) as { ok: boolean; error?: string };

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quit Fork manually/);
    expect(mergeMocks.setupMergeAttributes).not.toHaveBeenCalled();
  });

  it("fork half succeeds → merge attributes run against the chosen target", async () => {
    forkMocks.forkExecute.mockResolvedValue({ ok: true, backupPath: "/tmp/fork.plist.bak" });
    mergeMocks.setupMergeAttributes.mockResolvedValue({ status: "ok", detail: "wrote marker block" });

    const result = (await capabilities.fork(stubSession(), {
      setupBeyondCompare:   false,
      applyMergeAttributes: true,
      mergeTarget:          "/tmp/proj",
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(mergeMocks.setupMergeAttributes).toHaveBeenCalledWith("/tmp/proj");
  });
});
