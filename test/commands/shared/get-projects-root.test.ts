/**
 * test/commands/shared/get-projects-root.test.ts — Unit tests for the projects-root
 * resolver.
 *
 * getProjectsRoot is now a pure resolver + hard-fail backstop: the interactive
 * prompt + saveConfig was removed (moved to the startup first-run guard, which
 * launches `scvn config`). resolveProjectsRoot is the shared resolution helper.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import {
  resolveProjectsRoot,
  getProjectsRoot,
  MISSING_PROJECTS_ROOT_MESSAGE,
} from "../../../src/commands/shared/project-discovery.js";

const ENV_KEY = "SCVN_PROJECTS_ROOT";
let origEnv: string | undefined;

beforeEach(() => {
  origEnv = process.env[ENV_KEY];
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (origEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = origEnv;
  vi.restoreAllMocks();
});

describe("resolveProjectsRoot (root + source)", () => {
  it("returns the configured root from config, sourced from file", async () => {
    const resolved = await resolveProjectsRoot(async () => ({ projectsRoot: "/vol/projects" }));
    expect(resolved).toEqual({ root: "/vol/projects", source: "file" });
  });

  it("falls back to SCVN_PROJECTS_ROOT env when config is empty", async () => {
    process.env[ENV_KEY] = "/env/projects";
    const resolved = await resolveProjectsRoot(async () => ({}));
    expect(resolved).toEqual({ root: "/env/projects", source: "env" });
  });

  it("env wins over a set config value and is reported as source env", async () => {
    process.env[ENV_KEY] = "/env/projects";
    const resolved = await resolveProjectsRoot(async () => ({ projectsRoot: "/vol/projects" }));
    expect(resolved).toEqual({ root: "/env/projects", source: "env" });
  });

  it("expands a leading ~", async () => {
    const resolved = await resolveProjectsRoot(async () => ({ projectsRoot: "~/Games" }));
    expect(resolved).toEqual({ root: `${homedir()}/Games`, source: "file" });
  });

  it("returns null root and source when unset (no config, no env)", async () => {
    const resolved = await resolveProjectsRoot(async () => ({}));
    expect(resolved).toEqual({ root: null, source: null });
  });

  it("treats a whitespace-only value as unset", async () => {
    const resolved = await resolveProjectsRoot(async () => ({ projectsRoot: "   " }));
    expect(resolved).toEqual({ root: null, source: null });
  });
});

describe("getProjectsRoot", () => {
  it("returns the resolved root when set", async () => {
    const root = await getProjectsRoot({ loadConfig: async () => ({ projectsRoot: "/vol/p" }) });
    expect(root).toBe("/vol/p");
  });

  it("hard-fails with the message when unset (backstop)", async () => {
    const fail = vi.fn((m: string) => {
      throw new Error(m);
    }) as unknown as (m: string) => never;
    await expect(
      getProjectsRoot({ loadConfig: async () => ({}), fail }),
    ).rejects.toThrow(MISSING_PROJECTS_ROOT_MESSAGE);
    expect(fail).toHaveBeenCalledWith(MISSING_PROJECTS_ROOT_MESSAGE);
  });
});
