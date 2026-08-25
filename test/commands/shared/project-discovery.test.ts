/**
 * test/commands/shared/project-discovery.test.ts — Unit tests for the
 * projectsToOptions picker chrome: `name (scene) · branch` labels, age hints,
 * and the optional version-mismatch hint used by `scvn fork`.
 *
 * Pure function — no mocks. mtimeMs is derived from Date.now() at fixture
 * build time; minute-resolution age rounding keeps assertions stable.
 */

import { describe, it, expect } from "vitest";
import { projectsToOptions } from "../../../src/commands/shared/project-discovery.js";
import type { Project } from "../../../src/services/discover.js";

function mkProject(overrides: Partial<Project> = {}): Project {
  return {
    path:           "/projects/luna/Assets",
    projectRoot:    "/projects/luna",
    projectVersion: "2022.3.10f1",
    name:           "luna",
    scene:          "main",
    branch:         "main",
    mtimeMs:        Date.now() - 5 * 60_000,
    ...overrides,
  };
}

describe("projectsToOptions", () => {
  it("renders `name (scene) · branch` label, Assets-path value, age hint", () => {
    const [opt] = projectsToOptions([mkProject()]);
    expect(opt?.value).toBe("/projects/luna/Assets");
    expect(opt?.label).toBe("luna (main) · main");
    expect(opt?.hint).toBe("5m ago");
  });

  it("omits the branch part when branch is null", () => {
    const [opt] = projectsToOptions([mkProject({ branch: null })]);
    expect(opt?.label).toBe("luna (main)");
  });

  it("drops the redundant `(scene)` part when scene equals the project name", () => {
    const [opt] = projectsToOptions([mkProject({ name: "luna_lumberchopper", scene: "luna_lumberchopper" })]);
    expect(opt?.label).toBe("luna_lumberchopper · main");
  });

  it("prefixes a version-mismatch hint when editorVersion differs", () => {
    const [opt] = projectsToOptions(
      [mkProject({ projectVersion: "6000.0.1f1" })],
      { editorVersion: "2022.3.10f1" },
    );
    expect(opt?.hint).toMatch(/version mismatch \(project 6000\.0\.1f1, editor 2022\.3\.10f1\)/);
    expect(opt?.hint).toMatch(/5m ago$/);
  });

  it("keeps the plain age hint when versions match", () => {
    const [opt] = projectsToOptions([mkProject()], { editorVersion: "2022.3.10f1" });
    expect(opt?.hint).toBe("5m ago");
  });

  it("keeps the plain age hint when projectVersion is null", () => {
    const [opt] = projectsToOptions(
      [mkProject({ projectVersion: null })],
      { editorVersion: "2022.3.10f1" },
    );
    expect(opt?.hint).toBe("5m ago");
  });
});
