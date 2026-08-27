/**
 * test/features/resolve-add-folder.test.ts — Picked-folder → package resolution.
 *
 * resolveAddFolderWithinRoot is pure segment math over a known root; the
 * resolveAddFolder walk-up runs against REAL tmp dirs (the ProjectVersion.txt
 * marker is the only I/O). Together they pin the project-root-relative
 * identity: Assets/ content, embedded UPM packages, and custom root folders
 * all stage under their true location.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findNearestProjectRoot,
  resolveAddFolder,
  resolveAddFolderWithinRoot,
} from "../../src/features/packages/resolve-add-folder.js";

describe("resolveAddFolderWithinRoot (pure core)", () => {
  const ROOT = "/projects/hub";

  it("resolves an Assets folder to its root-relative identity", () => {
    const result = resolveAddFolderWithinRoot(`${ROOT}/Assets/Plugins/Sirenix`, ROOT);
    expect(result).toEqual({
      status: "ok",
      folder: { label: "Sirenix", relPath: "Assets/Plugins/Sirenix", projectRoot: ROOT },
    });
  });

  it("resolves an embedded UPM package", () => {
    const result = resolveAddFolderWithinRoot(`${ROOT}/Packages/com.acme.core`, ROOT);
    expect(result).toEqual({
      status: "ok",
      folder: { label: "com.acme.core", relPath: "Packages/com.acme.core", projectRoot: ROOT },
    });
  });

  it("resolves a custom root-level folder", () => {
    const result = resolveAddFolderWithinRoot(`${ROOT}/SharedTools`, ROOT);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.folder.relPath).toBe("SharedTools");
  });

  it("rejects the project root itself", () => {
    const result = resolveAddFolderWithinRoot(ROOT, ROOT);
    expect(result.status).toBe("invalid");
  });

  it("rejects Unity's special top-level dirs picked whole", () => {
    for (const dir of ["Assets", "Packages", "ProjectSettings"]) {
      const result = resolveAddFolderWithinRoot(`${ROOT}/${dir}`, ROOT);
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") expect(result.message).toContain(dir);
    }
  });

  it("allows folders nested inside the special dirs", () => {
    const result = resolveAddFolderWithinRoot(`${ROOT}/Assets/Assets/Foo`, ROOT);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.folder.relPath).toBe("Assets/Assets/Foo");
  });

  it("rejects unsafe relative paths", () => {
    const result = resolveAddFolderWithinRoot(`${ROOT}/../escape`, ROOT);
    expect(result.status).toBe("invalid");
  });
});

describe("findNearestProjectRoot (marker walk-up)", () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scvn-resolve-add-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    project = join(root, "hub");
    await mkdir(join(project, "Assets", "Plugins", "Sirenix"), { recursive: true });
    await mkdir(join(project, "Packages", "com.acme.core"), { recursive: true });
    await mkdir(join(project, "SharedTools"), { recursive: true });
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1", "utf8");
    // A second, NESTED project inside the outer one's Assets
    await mkdir(join(project, "Assets", "Embedded", "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "Assets", "Embedded", "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 2022.3.1f1", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds the project root from an Assets subfolder", async () => {
    await expect(findNearestProjectRoot(join(project, "Assets", "Plugins", "Sirenix"))).resolves.toBe(project);
  });

  it("finds the project root from a root-level folder", async () => {
    await expect(findNearestProjectRoot(join(project, "Packages", "com.acme.core"))).resolves.toBe(project);
  });

  it("accepts the project root itself", async () => {
    await expect(findNearestProjectRoot(project)).resolves.toBe(project);
  });

  it("prefers the NEAREST enclosing project (nested project wins)", async () => {
    const embedded = join(project, "Assets", "Embedded");
    await expect(findNearestProjectRoot(embedded)).resolves.toBe(embedded);
  });

  it("returns null outside any Unity project", async () => {
    await mkdir(join(root, "loose", "Assets"), { recursive: true }); // Assets dir but no marker
    await expect(findNearestProjectRoot(join(root, "loose", "Assets"))).resolves.toBeNull();
  });

  it("does not treat a mere Assets folder pair as a project (marker required)", async () => {
    await mkdir(join(root, "fake", "ProjectSettings"), { recursive: true });
    await mkdir(join(root, "fake", "Assets"), { recursive: true });
    await expect(findNearestProjectRoot(join(root, "fake", "Assets"))).resolves.toBeNull();
  });
});

describe("resolveAddFolder (walk-up + core)", () => {
  let root: string;
  let project: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scvn-resolve-full-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    project = join(root, "hub");
    await mkdir(join(project, "ProjectSettings"), { recursive: true });
    await writeFile(join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1", "utf8");
    await mkdir(join(project, "Assets", "Plugins", "Sirenix"), { recursive: true });
    await mkdir(join(project, "Packages", "com.acme.core"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves an Assets pick end-to-end", async () => {
    const result = await resolveAddFolder(join(project, "Assets", "Plugins", "Sirenix"));
    expect(result).toEqual({
      status: "ok",
      folder: { label: "Sirenix", relPath: "Assets/Plugins/Sirenix", projectRoot: project },
    });
  });

  it("resolves an embedded UPM pick end-to-end", async () => {
    const result = await resolveAddFolder(join(project, "Packages", "com.acme.core"));
    expect(result).toEqual({
      status: "ok",
      folder: { label: "com.acme.core", relPath: "Packages/com.acme.core", projectRoot: project },
    });
  });

  it("rejects a folder outside any Unity project with a marker-named reason", async () => {
    const loose = join(root, "loose-folder");
    await mkdir(loose, { recursive: true });
    const result = await resolveAddFolder(loose);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") expect(result.message).toContain("ProjectSettings/ProjectVersion.txt");
  });

  it("rejects the whole Assets/ dir end-to-end", async () => {
    const result = await resolveAddFolder(join(project, "Assets"));
    expect(result.status).toBe("invalid");
  });
});
