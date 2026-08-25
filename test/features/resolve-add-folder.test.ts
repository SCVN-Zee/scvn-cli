/**
 * test/features/resolve-add-folder.test.ts — Pure resolver for the add flow.
 *
 * resolveAddFolder turns a picked folder into a stageable package by deriving
 * its Assets-relative path (the identity import + the store mirror key on). It
 * is pure segment inspection: these cases pin the accept/reject boundary the
 * `scvn packages add` flow and the desktop `packages:resolve-source` both rely
 * on.
 */

import { describe, it, expect } from "vitest";
import { resolveAddFolder } from "../../src/features/packages/resolve-add-folder.js";

describe("resolveAddFolder", () => {
  it("resolves a nested Assets folder, preserving its Assets-relative path", () => {
    const result = resolveAddFolder("/projects/hub/Assets/Plugins/Sirenix");
    expect(result).toEqual({
      status: "ok",
      folder: {
        assetsDir: "/projects/hub/Assets",
        relPath: "Plugins/Sirenix",
        label: "Sirenix",
      },
    });
  });

  it("resolves a top-level Assets folder (label = folder name)", () => {
    const result = resolveAddFolder("/projects/hub/Assets/vFolders");
    expect(result).toEqual({
      status: "ok",
      folder: {
        assetsDir: "/projects/hub/Assets",
        relPath: "vFolders",
        label: "vFolders",
      },
    });
  });

  it("rejects the Assets/ dir itself — a subfolder is required", () => {
    const result = resolveAddFolder("/projects/hub/Assets");
    expect(result.status).toBe("invalid");
  });

  it("rejects a folder outside any Assets/ tree", () => {
    const result = resolveAddFolder("/tmp/some-loose-folder");
    expect(result).toEqual({
      status: "invalid",
      message: "/tmp/some-loose-folder is not inside a Unity project's Assets/ folder",
    });
  });

  it("rejects a path that would escape via a .. segment", () => {
    const result = resolveAddFolder("/projects/hub/Assets/../evil");
    expect(result.status).toBe("invalid");
  });
});
