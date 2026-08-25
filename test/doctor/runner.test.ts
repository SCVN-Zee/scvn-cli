/**
 * test/doctor/runner.test.ts — Unit tests for doctor/runner.ts
 *
 * Uses mocked Check objects (no real shell-outs) to verify:
 *   - [pass, warn]    → exitCode 0
 *   - [pass, fail]    → exitCode 1
 *   - [pass, skipped] → exitCode 0
 *   - all fail        → exitCode 1
 *   - rejected promise → treated as fail, exitCode 1
 */

import { describe, it, expect } from "vitest";
import { run } from "../../src/doctor/runner.js";
import type { Check } from "../../src/doctor/checks.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(id: string, severity: "pass" | "warn" | "fail" | "skipped", detail?: string): Check {
  return {
    id,
    label: `check-${id}`,
    run: async () => ({ severity, detail }),
  };
}

function makeRejecting(id: string): Check {
  return {
    id,
    label: `check-${id}`,
    run: async () => { throw new Error("boom"); },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runner.run()", () => {
  it("exits 0 when checks are [pass, warn]", async () => {
    const result = await run([
      makeCheck("a", "pass"),
      makeCheck("b", "warn", "rsync < 3.1"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]?.severity).toBe("pass");
    expect(result.reports[1]?.severity).toBe("warn");
  });

  it("exits 1 when checks are [pass, fail]", async () => {
    const result = await run([
      makeCheck("a", "pass"),
      makeCheck("b", "fail", "git not found"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.reports[1]?.severity).toBe("fail");
  });

  it("exits 0 when checks are [pass, skipped]", async () => {
    const result = await run([
      makeCheck("a", "pass"),
      makeCheck("b", "skipped", "macOS only — skipped"),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.reports[1]?.severity).toBe("skipped");
  });

  it("exits 1 when all checks fail", async () => {
    const result = await run([
      makeCheck("a", "fail"),
      makeCheck("b", "fail"),
    ]);
    expect(result.exitCode).toBe(1);
  });

  it("exits 0 when all checks pass", async () => {
    const result = await run([
      makeCheck("a", "pass"),
      makeCheck("b", "pass"),
      makeCheck("c", "pass"),
    ]);
    expect(result.exitCode).toBe(0);
  });

  it("treats a rejected check promise as fail", async () => {
    const result = await run([
      makeCheck("a", "pass"),
      makeRejecting("bad"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.reports[1]?.severity).toBe("fail");
    expect(result.reports[1]?.detail).toMatch(/boom/);
  });

  it("reports preserve id and label", async () => {
    const result = await run([
      makeCheck("rsync", "pass", "rsync 3.2.7"),
    ]);
    expect(result.reports[0]?.id).toBe("rsync");
    expect(result.reports[0]?.label).toBe("check-rsync");
    expect(result.reports[0]?.detail).toBe("rsync 3.2.7");
  });

  it("runs all checks in parallel (all settle)", async () => {
    // Mix of all severities — just confirm all 4 reports returned
    const result = await run([
      makeCheck("a", "pass"),
      makeCheck("b", "warn"),
      makeCheck("c", "skipped"),
      makeCheck("d", "fail"),
    ]);
    expect(result.reports).toHaveLength(4);
    expect(result.exitCode).toBe(1);
  });

  it("passes the context to each check's run()", async () => {
    const seen: unknown[] = [];
    const spy: Check = {
      id: "spy", label: "spy",
      run: async (ctx) => { seen.push(ctx); return { severity: "pass" }; },
    };

    await run([spy], { storeOverride: "/X" });

    expect(seen).toEqual([{ storeOverride: "/X" }]);
  });
});
