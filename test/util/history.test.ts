/**
 * test/util/history.test.ts — Tests for the JSONL project history helpers.
 *
 * Focuses on getLastProjectsByRole (used by sync dashboard pre-fill).
 * Stubs HISTORY_PATH via vi.mock of config/paths.js.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let tmpDir: string;
let historyPath: string;

vi.mock("../../src/config/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/paths.js")>();
  return {
    ...actual,
    getHistoryPath: () => historyPath,
  };
});

import { appendHistory, getLastProjectsByRole, getRecentProjects } from "../../src/util/history.js";

beforeEach(async () => {
  tmpDir      = await mkdtemp(path.join(tmpdir(), "scvn-history-"));
  historyPath = path.join(tmpDir, "history.jsonl");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("getLastProjectsByRole", () => {
  it("returns null pair when file missing", async () => {
    expect(await getLastProjectsByRole()).toEqual({ src: null, target: null });
  });

  it("returns most recent src and tgt scoped by role", async () => {
    await appendHistory({ ts: "1", kind: "config", src: "/a/old", status: "ok" });
    await appendHistory({ ts: "2", kind: "config", target: "/b/old", status: "ok" });
    await appendHistory({ ts: "3", kind: "config", src: "/a/new", status: "ok" });
    await appendHistory({ ts: "4", kind: "config", target: "/b/new", status: "ok" });

    expect(await getLastProjectsByRole()).toEqual({ src: "/a/new", target: "/b/new" });
  });

  it("returns null for a role that was never recorded", async () => {
    await appendHistory({ ts: "1", kind: "config", src: "/only-src", status: "ok" });
    expect(await getLastProjectsByRole()).toEqual({ src: "/only-src", target: null });
  });

  it("ignores malformed lines and continues scanning", async () => {
    await appendHistory({ ts: "1", kind: "config", src: "/good/src", status: "ok" });
    await writeFile(historyPath, "this is not json\n", { flag: "a" });
    await appendHistory({ ts: "2", kind: "config", target: "/good/tgt", status: "ok" });

    expect(await getLastProjectsByRole()).toEqual({ src: "/good/src", target: "/good/tgt" });
  });

  it("getRecentProjects still works alongside the new helper", async () => {
    await appendHistory({ ts: "1", kind: "config", src: "/p1", status: "ok" });
    await appendHistory({ ts: "2", kind: "config", target: "/p2", status: "ok" });

    expect(await getRecentProjects(5)).toEqual(["/p2", "/p1"]);
  });
});
