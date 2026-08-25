/**
 * test/commands/shared/select-setup-target.test.ts — discoverSetupTargets()
 *
 * The desktop form's `setup:prepare` step reuses this to populate the target
 * select. Mocks the discover service and resolves the root from SCVN_PROJECTS_ROOT
 * so no real filesystem scan happens; the option mapping (projectsToOptions) is
 * exercised for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Project } from "../../../src/services/discover.js";
import { discoverSetupTargets } from "../../../src/commands/shared/select-setup-target.js";

const discoverMock = vi.hoisted(() => ({ discoverUnityProjects: vi.fn() }));
vi.mock("../../../src/services/discover.js", () => ({
  discoverUnityProjects: discoverMock.discoverUnityProjects,
}));

const FAKE: Project[] = [
  {
    path: "/projects/Game/Assets",
    projectRoot: "/projects/Game",
    name: "Game",
    scene: "Main",
    branch: "main",
    mtimeMs: Date.now(),
    projectVersion: "2022.3.10f1",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env["SCVN_PROJECTS_ROOT"] = "/projects";
});

afterEach(() => {
  delete process.env["SCVN_PROJECTS_ROOT"];
});

describe("discoverSetupTargets()", () => {
  it("returns the resolved root and select-ready options", async () => {
    discoverMock.discoverUnityProjects.mockResolvedValue(FAKE);

    const { root, projects } = await discoverSetupTargets();

    expect(root).toBe("/projects");
    expect(discoverMock.discoverUnityProjects).toHaveBeenCalledWith("/projects");
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ value: "/projects/Game/Assets" });
    expect(projects[0]?.label).toContain("Game");
  });

  it("returns an empty option list when nothing is discovered", async () => {
    discoverMock.discoverUnityProjects.mockResolvedValue([]);

    const { projects } = await discoverSetupTargets();
    expect(projects).toEqual([]);
  });
});
