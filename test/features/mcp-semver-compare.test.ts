/**
 * test/features/mcp-semver-compare.test.ts — SemVer precedence for version picking.
 *
 * Ports the bash `vkey` tuple (unity-mcp-localize.sh:350). The two traps it
 * guards: 0.82.10 must outrank 0.82.4 (numeric, not lexical), and a release must
 * outrank any prerelease of the same release.
 */

import { describe, it, expect } from "vitest";
import { semverMax, caretSatisfies } from "../../src/features/mcp/semver-compare.js";

describe("semverMax", () => {
  it("orders numerically, not lexically", () => {
    expect(semverMax(["0.82.3", "0.82.4", "0.82.10"])).toBe("0.82.10");
    expect(semverMax(["1.9.0", "1.10.0"])).toBe("1.10.0");
  });

  it("ranks a release above a prerelease of the same release", () => {
    expect(semverMax(["1.0.0-rc.1", "1.0.0"])).toBe("1.0.0");
    expect(semverMax(["1.0.0", "1.0.0-rc.1"])).toBe("1.0.0");
  });

  it("orders prereleases among themselves", () => {
    expect(semverMax(["1.0.0-rc.2", "1.0.0-rc.10"])).toBe("1.0.0-rc.10");
    expect(semverMax(["1.0.0-alpha", "1.0.0-beta"])).toBe("1.0.0-beta");
  });

  it("ranks a prerelease below the next release", () => {
    expect(semverMax(["2.0.0-rc.1", "1.9.9"])).toBe("2.0.0-rc.1");
  });

  it("never cross-compares numeric and string prerelease identifiers", () => {
    // Numeric identifiers rank below alphanumeric ones (SemVer §11).
    expect(semverMax(["1.0.0-1", "1.0.0-alpha"])).toBe("1.0.0-alpha");
  });

  it("returns null for an empty list", () => {
    expect(semverMax([])).toBeNull();
  });

  it("returns the sole entry", () => {
    expect(semverMax(["0.82.4"])).toBe("0.82.4");
  });
});

describe("caretSatisfies", () => {
  it("accepts a higher minor/patch within the same major", () => {
    expect(caretSatisfies("^1.1.0", "1.2.1")).toBe(true);
    expect(caretSatisfies("^5.6.2", "5.6.2")).toBe(true);
    expect(caretSatisfies("^5.6.2", "5.9.9")).toBe(true);
  });

  it("rejects the next major and anything below the floor", () => {
    expect(caretSatisfies("^1.1.0", "2.0.0")).toBe(false);
    expect(caretSatisfies("^1.1.0", "1.0.9")).toBe(false);
  });

  it("pins the minor when the major is 0 (^0.2.3 → <0.3.0)", () => {
    expect(caretSatisfies("^0.2.3", "0.2.9")).toBe(true);
    expect(caretSatisfies("^0.2.3", "0.3.0")).toBe(false);
  });

  it("pins the patch when major and minor are 0 (^0.0.3 → <0.0.4)", () => {
    expect(caretSatisfies("^0.0.3", "0.0.3")).toBe(true);
    expect(caretSatisfies("^0.0.3", "0.0.4")).toBe(false);
  });

  it("excludes prereleases from a stable range", () => {
    // npm never resolves a caret range to a prerelease — a beta must not slip
    // into the offline CLI closure.
    expect(caretSatisfies("^5.6.2", "5.7.0-beta.1")).toBe(false);
  });

  it("treats a bare version as an exact pin", () => {
    expect(caretSatisfies("2.1.5", "2.1.5")).toBe(true);
    expect(caretSatisfies("2.1.5", "2.1.6")).toBe(false);
  });

  it("accepts any stable version for * / empty", () => {
    expect(caretSatisfies("*", "9.9.9")).toBe(true);
    expect(caretSatisfies("", "9.9.9")).toBe(true);
  });

  it("supports tilde (~1.2.3 → <1.3.0)", () => {
    expect(caretSatisfies("~1.2.3", "1.2.9")).toBe(true);
    expect(caretSatisfies("~1.2.3", "1.3.0")).toBe(false);
  });

  it("returns false for a range shape it cannot prove", () => {
    // Unprovable ranges must not silently resolve — the caller warns + falls back.
    expect(caretSatisfies(">=1.0.0 <2.0.0", "1.5.0")).toBe(false);
  });
});
