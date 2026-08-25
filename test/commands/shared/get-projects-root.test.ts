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

describe("resolveProjectsRoot", () => {
  it("returns the configured root from config", async () => {
    const root = await resolveProjectsRoot(async () => ({ projectsRoot: "/vol/projects" }));
    expect(root).toBe("/vol/projects");
  });

  it("falls back to SCVN_PROJECTS_ROOT env when config is empty", async () => {
    process.env[ENV_KEY] = "/env/projects";
    const root = await resolveProjectsRoot(async () => ({}));
    expect(root).toBe("/env/projects");
  });

  it("expands a leading ~", async () => {
    const root = await resolveProjectsRoot(async () => ({ projectsRoot: "~/Games" }));
    expect(root).toBe(`${homedir()}/Games`);
  });

  it("returns null when unset (no config, no env)", async () => {
    const root = await resolveProjectsRoot(async () => ({}));
    expect(root).toBeNull();
  });

  it("treats a whitespace-only value as unset", async () => {
    const root = await resolveProjectsRoot(async () => ({ projectsRoot: "   " }));
    expect(root).toBeNull();
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
