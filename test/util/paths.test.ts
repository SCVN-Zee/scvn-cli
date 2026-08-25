/**
 * test/util/paths.test.ts — Pure path-helper tests.
 *
 * resolveAssetsDir backs the desktop export folder-browse UX: whatever folder
 * the user picks, it walks up to the nearest `Assets` segment so the export flow
 * gets the Assets dir it expects. These cases pin the leaf-first walk and the
 * "no Assets segment" contract (the filesystem child-Assets fallback lives in
 * the caller, not here).
 */

import { describe, it, expect } from "vitest";
import { resolveAssetsDir, deriveProjectName } from "../../src/util/paths.js";

describe("resolveAssetsDir", () => {
  it("returns the folder itself when it is Assets", () => {
    expect(resolveAssetsDir("/projects/luna/Assets")).toBe("/projects/luna/Assets");
  });

  it("walks up to the nearest Assets ancestor from a nested folder", () => {
    expect(resolveAssetsDir("/projects/luna/Assets/Plugins/Sirenix")).toBe(
      "/projects/luna/Assets",
    );
  });

  it("ignores a trailing slash", () => {
    expect(resolveAssetsDir("/projects/luna/Assets/")).toBe("/projects/luna/Assets");
  });

  it("picks the deepest Assets when the path nests more than one", () => {
    expect(resolveAssetsDir("/a/Assets/b/Assets/c")).toBe("/a/Assets/b/Assets");
  });

  it("returns null when no segment is named Assets (e.g. a project root)", () => {
    expect(resolveAssetsDir("/projects/luna")).toBeNull();
  });

  it("does not match a segment that merely contains Assets", () => {
    expect(resolveAssetsDir("/projects/MyAssetsBackup/Plugins")).toBeNull();
  });

  it("resolves to an Assets dir a project name can be derived from", () => {
    const assets = resolveAssetsDir("/projects/luna/Assets/Art");
    expect(assets).not.toBeNull();
    expect(deriveProjectName(assets!)).toBe("luna");
  });
});
