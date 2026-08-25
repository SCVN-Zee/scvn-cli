/**
 * test/features/store-provenance.test.ts — Per-package provenance formatting.
 */

import { describe, it, expect } from "vitest";
import { formatPackageProvenance } from "../../src/features/store/store-provenance.js";
import type { StagedPackage } from "../../src/features/store/store-meta.js";

function pkgAgedBy(ageMs: number, overrides: Partial<StagedPackage> = {}): StagedPackage {
  return {
    label:      "vFolders",
    relPath:    "vFolders",
    bytes:      148_897_792, // 142.0 MB
    sourcePath: "/projects/hub/Assets",
    sourceName: "Hub",
    branch:     "main",
    stagedAt:   new Date(Date.now() - ageMs).toISOString(),
    ...overrides,
  };
}

describe("formatPackageProvenance", () => {
  it("formats name @ branch, age in days, size", () => {
    const line = formatPackageProvenance(pkgAgedBy(2 * 86_400_000));
    expect(line).toBe("Hub @ main, 2d ago, 142.0 MB");
  });

  it("omits branch part when branch is null", () => {
    const line = formatPackageProvenance(pkgAgedBy(3 * 3_600_000, { branch: null }));
    expect(line).toBe("Hub, 3h ago, 142.0 MB");
  });

  it("uses 'just now' for fresh stages", () => {
    const line = formatPackageProvenance(pkgAgedBy(5_000));
    expect(line).toBe("Hub @ main, just now, 142.0 MB");
  });

  it("formats GB sizes", () => {
    const line = formatPackageProvenance(pkgAgedBy(60_000 * 5, { bytes: 2_147_483_648 }));
    expect(line).toBe("Hub @ main, 5m ago, 2.0 GB");
  });
});
