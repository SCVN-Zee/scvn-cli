/**
 * test/commands/doctor.test.ts — Unit tests for commands/doctor.ts
 *
 * Drives runDoctor() with fake check lists (no real shell-outs, no TTY).
 * Verifies exit-code parity with the Ink doctor screen:
 *   - all pass/warn/skip  → process.exitCode === 0
 *   - any fail            → process.exitCode === 1
 *
 * Clack log output goes to stdout; we don't assert its exact format here
 * (that's a rendering concern) — just that the flow completes without throwing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Check } from "../../src/doctor/checks.js";
import { runDoctor } from "../../src/commands/doctor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCheck(
  id: string,
  severity: "pass" | "warn" | "fail" | "skipped",
  detail?: string,
): Check {
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
    run: async () => { throw new Error("unexpected-error"); },
  };
}

// ---------------------------------------------------------------------------
// Silence clack output during tests (it writes directly to process.stdout)
// ---------------------------------------------------------------------------

let stdoutWrite: typeof process.stdout.write;
let stderrWrite: typeof process.stderr.write;

beforeEach(() => {
  // Suppress clack's connector-bar output so test output stays clean.
  stdoutWrite = process.stdout.write.bind(process.stdout);
  stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  // Reset exit code before each test
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = stdoutWrite;
  process.stderr.write = stderrWrite;
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDoctor()", () => {
  it("sets exitCode 0 when all checks pass", async () => {
    await runDoctor([
      makeCheck("a", "pass"),
      makeCheck("b", "pass"),
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("sets exitCode 0 when checks are [pass, warn]", async () => {
    await runDoctor([
      makeCheck("a", "pass"),
      makeCheck("b", "warn", "rsync < 3.1"),
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("sets exitCode 0 when checks are [pass, skipped]", async () => {
    await runDoctor([
      makeCheck("a", "pass"),
      makeCheck("b", "skipped"),
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("sets exitCode 1 when any check fails", async () => {
    await runDoctor([
      makeCheck("a", "pass"),
      makeCheck("b", "fail", "git not found"),
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode 1 when all checks fail", async () => {
    await runDoctor([
      makeCheck("a", "fail"),
      makeCheck("b", "fail"),
    ]);
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode 1 when a check throws (rejected promise)", async () => {
    await runDoctor([
      makeCheck("a", "pass"),
      makeRejecting("bad"),
    ]);
    // runner converts rejections to severity "fail" → exitCode 1
    expect(process.exitCode).toBe(1);
  });

  it("sets exitCode 0 for mixed pass/warn/skipped (no fail)", async () => {
    await runDoctor([
      makeCheck("rsync", "pass", "rsync 3.2.7"),
      makeCheck("claude", "warn", "claude CLI not found"),
      makeCheck("fork", "skipped"),
    ]);
    expect(process.exitCode).toBe(0);
  });

  it("does not throw when the check list is empty", async () => {
    await expect(runDoctor([])).resolves.toBeUndefined();
    expect(process.exitCode).toBe(0);
  });
});
