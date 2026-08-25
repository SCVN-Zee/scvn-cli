/**
 * test/util/fatal-error.test.ts — formatFatal's expected-vs-bug split.
 *
 * The rule that matters: a `scvn:`-prefixed message is something a user can act
 * on, so it prints alone. Anything else is a programming error and must keep its
 * stack — collapsing a TypeError to one line would hide the bug.
 */

import { describe, expect, it } from "vitest";
import { formatFatal } from "../../src/util/fatal-error.js";

describe("formatFatal", () => {
  it("an expected scvn: error prints as a single line, no stack", () => {
    const err = new Error("scvn: source project not found at /projects/x/Assets");

    const out = formatFatal(err);
    expect(out).toBe("scvn: source project not found at /projects/x/Assets");
    // "at " also appears in the message itself — a stack frame is "\n    at ".
    expect(out).not.toMatch(/\n\s+at /);
  });

  it("multi-line scvn: errors keep their detail lines", () => {
    const err = new Error("scvn: no valid packages in /x\n  line 1: garbage");
    expect(formatFatal(err)).toContain("line 1: garbage");
  });

  it("an unexpected error keeps its stack — a bug must stay debuggable", () => {
    const bug = new TypeError("cannot read properties of undefined");

    const out = formatFatal(bug);
    expect(out).toContain("TypeError");
    expect(out).toContain("cannot read properties of undefined");
    expect(out).toMatch(/\n\s+at /); // stack frames survive
  });

  it("an Error without a stack falls back to its message", () => {
    const err = new Error("boom");
    err.stack = undefined;
    expect(formatFatal(err)).toBe("boom");
  });

  it("a thrown non-Error is prefixed so it still reads as scvn output", () => {
    expect(formatFatal("plain string")).toBe("scvn: plain string");
    expect(formatFatal(42)).toBe("scvn: 42");
  });

  it("does not treat a message merely containing scvn: as expected", () => {
    const bug = new Error("wrapped: scvn: something");
    expect(formatFatal(bug)).toMatch(/\n\s+at /);
  });
});
