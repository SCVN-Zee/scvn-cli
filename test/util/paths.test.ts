/**
 * test/util/paths.test.ts — Pure path-helper tests.
 *
 * deriveProjectName labels provenance and pickers from a project path (root
 * or Assets dir); these cases pin the "/Assets" suffix handling and the
 * last-segment fallback.
 */

import { describe, it, expect } from "vitest";
import { deriveProjectName } from "../../src/util/paths.js";

describe("deriveProjectName", () => {
  it("derives the project folder from an Assets dir path", () => {
    expect(deriveProjectName("/projects/luna/Assets")).toBe("luna");
  });

  it("falls back to the last segment for a project root path", () => {
    expect(deriveProjectName("/projects/luna")).toBe("luna");
  });

  it("falls back to the last segment for a nested package path", () => {
    expect(deriveProjectName("/projects/luna/Packages/com.acme.core")).toBe(
      "com.acme.core",
    );
  });
});
