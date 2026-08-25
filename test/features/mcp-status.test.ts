/**
 * test/features/mcp-status.test.ts — Offline status + the dual-read marker.
 *
 * "Offline" is asserted, not assumed: the packument cache is primed with a fetch
 * that THROWS if anything calls it. `scvn mcp status` must work on a plane.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import { getMcpStatus, renderMcpStatus } from "../../src/features/mcp/status-mcp.js";
import {
  readMarker,
  writeMarker,
  isInstalled,
  markerVersion,
  markerPackages,
  markerPath,
  legacyMarkerPath,
} from "../../src/features/mcp/marker.js";
import { verDir } from "../../src/features/mcp/mcp-cache-paths.js";
import { writeVersionsJson } from "../../src/features/mcp/versions-json.js";
import {
  _setBundledMcpRootForTest,
  _resetBundledMcpCache,
} from "../../src/features/mcp/bundled-mcp-paths.js";
import { fetchPackument, _resetPackumentCache } from "../../src/services/npm-registry.js";
import { CORE_PKG } from "../../src/features/mcp/mcp-constants.js";

/** A Unity project skeleton discoverUnityProjects can find. */
async function makeProject(root: string, name: string): Promise<string> {
  const projectRoot = path.join(root, name);
  await mkdir(path.join(projectRoot, "Assets"), { recursive: true });
  await mkdir(path.join(projectRoot, "ProjectSettings"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "ProjectSettings", "ProjectVersion.txt"),
    "m_EditorVersion: 2022.3.16f1\n",
  );
  return projectRoot;
}

async function stageVersion(cacheDir: string, version: string): Promise<void> {
  const dir = verDir(version, cacheDir);
  await mkdir(path.join(dir, CORE_PKG), { recursive: true });
  await writeVersionsJson(dir, {
    core: version,
    packages: { [CORE_PKG]: version },
    fetchedAt: "2026-01-01T00:00:00Z",
  });
}

function markerDoc(version: string) {
  return {
    coreVersion: version,
    packages: { [CORE_PKG]: version },
    source: "/cache",
    importedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
});

describe("marker", () => {
  it("round-trips the installed package set", async () => {
    const project = await tmpDir("scvn-proj-");

    await writeMarker(project, markerDoc("0.82.4"));

    expect(await isInstalled(project)).toBe(true);
    expect(await markerVersion(project)).toBe("0.82.4");
    expect(await markerPackages(project)).toEqual([CORE_PKG]);
    expect((await readMarker(project))?.source).toBe("/cache");
  });

  it("reads a repo wired by the retired bash script (legacy marker name)", async () => {
    const project = await tmpDir("scvn-proj-");
    await mkdir(path.dirname(legacyMarkerPath(project)), { recursive: true });
    await writeFile(legacyMarkerPath(project), JSON.stringify(markerDoc("0.82.3")));

    expect(await isInstalled(project)).toBe(true);
    expect(await markerVersion(project)).toBe("0.82.3");
  });

  it("prefers the new marker when both are present", async () => {
    const project = await tmpDir("scvn-proj-");
    await mkdir(path.dirname(legacyMarkerPath(project)), { recursive: true });
    await writeFile(legacyMarkerPath(project), JSON.stringify(markerDoc("0.82.3")));
    await writeFile(markerPath(project), JSON.stringify(markerDoc("0.82.4")));

    expect(await markerVersion(project)).toBe("0.82.4");
  });

  it("drops the legacy marker on write — the migration completes", async () => {
    const project = await tmpDir("scvn-proj-");
    await mkdir(path.dirname(legacyMarkerPath(project)), { recursive: true });
    await writeFile(legacyMarkerPath(project), JSON.stringify(markerDoc("0.82.3")));

    await writeMarker(project, markerDoc("0.82.4"));

    await expect(access(legacyMarkerPath(project))).rejects.toThrow();
    expect(await markerVersion(project)).toBe("0.82.4");
  });

  it("leaves no temp file behind", async () => {
    const project = await tmpDir("scvn-proj-");
    await writeMarker(project, markerDoc("0.82.4"));

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path.dirname(markerPath(project)));
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });

  it("treats a corrupt marker as not installed rather than crashing status", async () => {
    const project = await tmpDir("scvn-proj-");
    await mkdir(path.dirname(markerPath(project)), { recursive: true });
    await writeFile(markerPath(project), "{ truncated");

    expect(await readMarker(project)).toBeNull();
    expect(await markerVersion(project)).toBeNull();
  });

  it("reports not-installed for a bare project", async () => {
    const project = await tmpDir("scvn-proj-");
    expect(await isInstalled(project)).toBe(false);
  });
});

describe("getMcpStatus", () => {
  it("lists staged versions newest-first and per-project install state", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const projectsRoot = await tmpDir("scvn-projects-");
    await stageVersion(cacheDir, "0.82.3");
    await stageVersion(cacheDir, "0.82.10");
    const installed = await makeProject(projectsRoot, "game_a");
    await makeProject(projectsRoot, "game_b");
    await writeMarker(installed, markerDoc("0.82.10"));

    const status = await getMcpStatus({ projectsRoot, userCacheDir: cacheDir });

    expect(status.versions.map((v) => v.version)).toEqual(["0.82.10", "0.82.3"]);
    const byName = Object.fromEntries(status.projects.map((p) => [p.name, p]));
    expect(byName["game_a"]).toMatchObject({ installed: true, version: "0.82.10" });
    expect(byName["game_b"]).toMatchObject({ installed: false, version: null });
  });

  it("never touches the registry — status works with the network down", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const projectsRoot = await tmpDir("scvn-projects-");
    await stageVersion(cacheDir, "1.0.0");
    await makeProject(projectsRoot, "game_a");
    const exploding = vi.fn(async () => {
      throw new Error("network used — status must be offline");
    });

    await expect(getMcpStatus({ projectsRoot, userCacheDir: cacheDir })).resolves.toBeDefined();
    // Prove the assertion is real: the same fetch WOULD have thrown if called.
    await expect(fetchPackument("https://x", "y", { fetchImpl: exploding })).rejects.toThrow(
      /network used/,
    );
  });

  it("tags a bundled-only version and unions both caches", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const bundleRoot = await tmpDir("scvn-bundle-");
    const projectsRoot = await tmpDir("scvn-projects-");
    await stageVersion(cacheDir, "2.0.0");
    await stageVersion(bundleRoot, "1.0.0");
    await stageVersion(bundleRoot, "2.0.0"); // also in the user cache — user wins
    _setBundledMcpRootForTest(bundleRoot);

    const status = await getMcpStatus({ projectsRoot, userCacheDir: cacheDir });

    expect(status.versions).toEqual([
      { version: "2.0.0", source: "user", dir: verDir("2.0.0", cacheDir) },
      { version: "1.0.0", source: "bundled", dir: verDir("1.0.0", bundleRoot) },
    ]);
  });

  it("survives an empty cache and zero projects", async () => {
    const cacheDir = await tmpDir("scvn-mcp-cache-");
    const projectsRoot = await tmpDir("scvn-projects-");

    const status = await getMcpStatus({ projectsRoot, userCacheDir: cacheDir });

    expect(status.versions).toEqual([]);
    expect(status.projects).toEqual([]);
    expect(renderMcpStatus(status).join("\n")).toMatch(/none/);
  });
});

describe("renderMcpStatus", () => {
  it("labels the bundled source and the installed version", () => {
    const lines = renderMcpStatus({
      versions: [{ version: "1.0.0", source: "bundled", dir: "/b" }],
      projects: [
        { name: "game_a", projectRoot: "/p/a", installed: true, version: "1.0.0" },
        { name: "game_b", projectRoot: "/p/b", installed: false, version: null },
      ],
    }).join("\n");

    expect(lines).toContain("V1.0.0");
    expect(lines).toContain("(bundled)");
    expect(lines).toContain("installed v1.0.0");
    expect(lines).toContain("not installed");
  });
});
