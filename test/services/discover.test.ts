/**
 * test/services/discover.test.ts — Unit tests for the deep-scan project
 * discovery in src/services/discover.ts.
 *
 * Covers depth 3/4/5 layouts, fallback heuristic, missing Assets, ignored
 * dirs (Library), symlink loop avoidance (guarded), and mtime sort.
 *
 * git branch lookup is mocked to null so tests don't need real repos.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, utimes, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";

const getRepoInfoMock = vi.fn(async (_cwd: string) => ({ root: null as string | null, branch: null as string | null }));

vi.mock("../../src/services/git.js", () => ({
  getRepoInfo: getRepoInfoMock,
  getCurrentBranch: vi.fn().mockResolvedValue(null),
  getRepoRoot: vi.fn().mockResolvedValue(null),
}));

const { discoverUnityProjects } = await import("../../src/services/discover.js");

/** Create a minimal Unity project tree at `<root>/<rel>`. */
async function mkProject(root: string, rel: string): Promise<string> {
  const projectRoot = join(root, rel);
  await mkdir(join(projectRoot, "ProjectSettings"), { recursive: true });
  await writeFile(
    join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.0f1\n",
  );
  await mkdir(join(projectRoot, "Assets"), { recursive: true });
  await writeFile(join(projectRoot, "Assets", ".gitkeep"), "");
  return join(projectRoot, "Assets");
}

describe("discoverUnityProjects (deep-scan)", () => {
  beforeEach(() => {
    getRepoInfoMock.mockReset();
    getRepoInfoMock.mockResolvedValue({ root: null, branch: null });
  });

  it("finds legacy depth-3 layout and labels as `name (scene)`", async () => {
    const root = await tmpDir();
    const assets = await mkProject(root, "alpha/unity_project/scene1");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      path:           assets,
      projectRoot:    join(root, "alpha/unity_project/scene1"),
      projectVersion: "2022.3.0f1",
      name:           "alpha",
      scene:          "scene1",
    });
  });

  it("yields projectVersion null when ProjectVersion.txt is malformed", async () => {
    const root = await tmpDir();
    const projectRoot = join(root, "mal/unity_project/scene");
    await mkdir(join(projectRoot, "ProjectSettings"), { recursive: true });
    await writeFile(join(projectRoot, "ProjectSettings", "ProjectVersion.txt"), "garbage\n");
    await mkdir(join(projectRoot, "Assets"), { recursive: true });

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ projectRoot, projectVersion: null });
  });

  it("ignores node_modules/ subtrees", async () => {
    const root = await tmpDir();
    await mkProject(root, "node_modules/fake/unity_project/scene");
    await mkProject(root, "alpha/unity_project/scene1");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("alpha");
  });

  it("returns [] for an empty directory", async () => {
    const root = await tmpDir();
    expect(await discoverUnityProjects(root)).toEqual([]);
  });

  it("finds nested depth-4 layout and uses first segment as name", async () => {
    const root = await tmpDir();
    await mkProject(root, "category/beta/unity_project/scene2");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "category", scene: "scene2" });
  });

  it("finds nested depth-5 layout", async () => {
    const root = await tmpDir();
    await mkProject(root, "group/sub/gamma/unity_project/scene3");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "group", scene: "scene3" });
  });

  it("non-legacy layout falls back to first-segment name + projectRoot basename scene", async () => {
    const root = await tmpDir();
    await mkProject(root, "delta/sub");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "delta", scene: "sub" });
  });

  it("skips projects without Assets/ directory", async () => {
    const root = await tmpDir();
    const projectRoot = join(root, "no-assets/unity_project/scene");
    await mkdir(join(projectRoot, "ProjectSettings"), { recursive: true });
    await writeFile(
      join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
      "m_EditorVersion: 2022.3.0f1\n",
    );

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(0);
  });

  it("ignores Library/ subtrees", async () => {
    const root = await tmpDir();
    await mkProject(root, "Library/zeta/unity_project/scene4");
    await mkProject(root, "alpha/unity_project/scene1");

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("alpha");
  });

  it("does not follow symlinks (no duplicate projects)", async () => {
    const root = await tmpDir();
    const realRoot = await tmpDir();
    await mkProject(realRoot, "epsilon/unity_project/scene5");
    try {
      await symlink(realRoot, join(root, "link"));
    } catch (err) {
      // symlinks unsupported on this platform/CI; skip
      const msg = (err as NodeJS.ErrnoException).code;
      if (msg === "EPERM" || msg === "EACCES") return;
      throw err;
    }

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(0);
  });

  it("git-aware label: name from .git folder, scene from path repo→projectRoot", async () => {
    const root = await tmpDir();
    const repoRoot = join(root, "DinoUniverse/luna_dino");
    const projectRoot = join(repoRoot, "luna_dino-playable-009");
    await mkProject(root, "DinoUniverse/luna_dino/luna_dino-playable-009");
    getRepoInfoMock.mockImplementation(async () => ({ root: repoRoot, branch: "Playables/playable009" }));

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "luna_dino",
      scene: "luna_dino-playable-009",
      branch: "Playables/playable009",
      path: join(projectRoot, "Assets"),
    });
  });

  it("git-aware label: scene falls back to basename when projectRoot === repoRoot", async () => {
    const root = await tmpDir();
    const repoRoot = join(root, "container/luna_pizza");
    await mkProject(root, "container/luna_pizza");
    getRepoInfoMock.mockImplementation(async () => ({ root: repoRoot, branch: "main" }));

    const out = await discoverUnityProjects(root);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "luna_pizza", scene: "luna_pizza", branch: "main" });
  });

  it("sorts by mtime descending", async () => {
    const root = await tmpDir();
    const aAssets = await mkProject(root, "alpha/unity_project/s1");
    const bAssets = await mkProject(root, "bravo/unity_project/s2");

    const oldTime = new Date("2024-01-01T00:00:00Z");
    const newTime = new Date("2025-01-01T00:00:00Z");
    await utimes(aAssets, oldTime, oldTime);
    await utimes(bAssets, newTime, newTime);

    const out = await discoverUnityProjects(root);
    expect(out.map((p) => p.name)).toEqual(["bravo", "alpha"]);
  });
});
