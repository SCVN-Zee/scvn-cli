/**
 * test/features/mcp-check-updates.test.ts — Online coherent solve + per-package
 * diff. Fail-soft: pin conflicts and dead registries are results, never throws.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import { fakeRegistry } from "../helpers/mcp-registry-fake.js";
import type { FakePackage } from "../helpers/mcp-registry-fake.js";
import { makeCoreFixture, makeAddonFixture } from "../helpers/mcp-fixtures.js";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import { writeMarker } from "../../src/features/mcp/marker.js";
import { checkUpdates } from "../../src/features/mcp/check-updates.js";
import { CORE_PKG, PPX_PKG } from "../../src/features/mcp/mcp-constants.js";

const OLD_CORE = "0.84.1";
const NEW_CORE = "0.86.0";
const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";
const OLD_ADDON = "1.2.24";
const NEW_ADDON = "1.2.25";
const PPX_VER = "2.1.5";

beforeEach(() => {
  _resetPackumentCache();
});

function corePkg(version: string): FakePackage {
  return {
    name: CORE_PKG,
    version,
    build: makeCoreFixture,
    dependencies: { [PPX_PKG]: PPX_VER },
  };
}

function addonPkg(name: string, version: string, pinsCore: string): FakePackage {
  return { name, version, build: makeAddonFixture, pinsCore };
}

function ppxPkg(version: string): FakePackage {
  return { name: PPX_PKG, version, build: makeAddonFixture };
}

/** Assets-dir target whose parent is the Unity project root (picker shape). */
async function makeTarget(): Promise<{ project: string; target: string }> {
  const project = await tmpDir("scvn-mcp-check-");
  const target = path.join(project, "Assets");
  await mkdir(target, { recursive: true });
  return { project, target };
}

describe("checkUpdates", () => {
  it("diffs a newer core AND a same-core addon bump on an installed project", async () => {
    const { project, target } = await makeTarget();
    await writeMarker(project, {
      coreVersion: OLD_CORE,
      packages: {
        [CORE_PKG]: OLD_CORE,
        [ANIMATION]: OLD_ADDON,
        [PPX_PKG]: PPX_VER,
      },
      source: "test",
      importedAt: "2026-01-01T00:00:00.000Z",
    });

    // Newer core 0.86.0, plus animation 1.2.24 → 1.2.25 both pinning that core.
    const { fetchImpl } = await fakeRegistry([
      corePkg(OLD_CORE),
      corePkg(NEW_CORE),
      addonPkg(ANIMATION, OLD_ADDON, NEW_CORE),
      addonPkg(ANIMATION, NEW_ADDON, NEW_CORE),
      ppxPkg(PPX_VER),
    ]);

    const result = await checkUpdates([ANIMATION], { target, fetchImpl });

    expect(result.offline).toBe(false);
    expect(result.conflict).toBeNull();
    expect(result.current).toEqual({
      [CORE_PKG]: OLD_CORE,
      [ANIMATION]: OLD_ADDON,
      [PPX_PKG]: PPX_VER,
    });
    expect(result.resolved).toEqual({
      core: NEW_CORE,
      packages: {
        [CORE_PKG]: NEW_CORE,
        [ANIMATION]: NEW_ADDON,
        [PPX_PKG]: PPX_VER,
      },
    });
    expect(result.updates).toEqual(
      expect.arrayContaining([
        { pkg: CORE_PKG, from: OLD_CORE, to: NEW_CORE },
        { pkg: ANIMATION, from: OLD_ADDON, to: NEW_ADDON },
      ]),
    );
    expect(result.catalog).toEqual([{ addon: ANIMATION, newestPublished: NEW_ADDON }]);
  });

  it("returns resolved:null + a conflict when the addon set shares no core, and does not throw", async () => {
    const { fetchImpl } = await fakeRegistry([
      corePkg("0.83.1"),
      corePkg("0.84.2"),
      addonPkg(ANIMATION, "1.2.26", "0.84.2"),
      addonPkg(PARTICLE, "1.2.25", "0.83.1"),
    ]);

    const result = await checkUpdates([ANIMATION, PARTICLE], { fetchImpl });

    expect(result.resolved).toBeNull();
    expect(result.offline).toBe(false);
    expect(result.conflict).toMatch(/no core version has a build of every requested addon/);
    expect(result.updates).toEqual([]);
    // The chooser still offers every published core; none is compatible, so
    // every pick needs the override.
    expect(result.coreVersions).toEqual(["0.84.2", "0.83.1"]);
    expect(result.compatibleCores).toEqual([]);
  });

  it("returns offline:true on a simulated registry failure, and does not throw", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network is down");
    });

    const result = await checkUpdates([ANIMATION], { fetchImpl });

    expect(result.resolved).toBeNull();
    expect(result.offline).toBe(true);
    expect(result.conflict).toBeNull();
    expect(result.updates).toEqual([]);
    expect(result.coreVersions).toEqual([]);
    expect(result.compatibleCores).toEqual([]);
  });

  it("lists every resolved package as from:null when the target is not installed", async () => {
    const { target } = await makeTarget();
    const { fetchImpl } = await fakeRegistry([
      corePkg(NEW_CORE),
      addonPkg(ANIMATION, NEW_ADDON, NEW_CORE),
      ppxPkg(PPX_VER),
    ]);

    const result = await checkUpdates([ANIMATION], { target, fetchImpl });

    expect(result.current).toBeNull();
    expect(result.offline).toBe(false);
    expect(result.conflict).toBeNull();
    expect(result.resolved?.core).toBe(NEW_CORE);
    expect(result.updates).toEqual([
      { pkg: CORE_PKG, from: null, to: NEW_CORE },
      { pkg: ANIMATION, from: null, to: NEW_ADDON },
      { pkg: PPX_PKG, from: null, to: PPX_VER },
    ]);
  });

  it("reports the core's true latest even when the addon set caps the install target below it", async () => {
    const CAPPED = "0.88.0";
    const NEWEST = "0.90.0";
    const { target } = await makeTarget();
    // Core publishes 0.90.0 (added last → dist-tags.latest), but animation's
    // newest build still pins 0.88.0 — the real-world Unity-MCP situation.
    const { fetchImpl } = await fakeRegistry([
      corePkg(CAPPED),
      corePkg(NEWEST),
      addonPkg(ANIMATION, NEW_ADDON, CAPPED),
      ppxPkg(PPX_VER),
    ]);

    const result = await checkUpdates([ANIMATION], { target, fetchImpl });

    expect(result.offline).toBe(false);
    expect(result.conflict).toBeNull();
    // The install target is the coherent cap, NOT the newest published core.
    expect(result.resolved?.core).toBe(CAPPED);
    // ...but the payload still carries 0.90.0 so the tab shows the gap instead
    // of mislabeling the capped core as "latest" (the reported bug).
    expect(result.coreNewestPublished).toBe(NEWEST);
  });

  it("exposes the version chooser menu (newest-first) and marks the compatible subset", async () => {
    const CAP = "0.88.0";
    const NEWEST = "0.90.0";
    // Core publishes 0.88.0 then 0.90.0; animation only ships a build pinning
    // 0.88.0 — so 0.90.0 is offered but not compatible (the reported situation).
    const { fetchImpl } = await fakeRegistry([
      corePkg(CAP),
      corePkg(NEWEST),
      addonPkg(ANIMATION, NEW_ADDON, CAP),
      ppxPkg(PPX_VER),
    ]);

    const result = await checkUpdates([ANIMATION], { fetchImpl });

    // Every published stable core, newest-first — the chooser's full menu.
    expect(result.coreVersions).toEqual([NEWEST, CAP]);
    // Only cores animation pins are compatible; picking 0.90.0 forces a skew.
    expect(result.compatibleCores).toEqual([CAP]);
  });

  it("spans the full menu via catalogAddons while solving only the selected set", async () => {
    const { fetchImpl } = await fakeRegistry([
      corePkg(NEW_CORE),
      addonPkg(ANIMATION, NEW_ADDON, NEW_CORE),
      addonPkg(PARTICLE, "1.2.30", NEW_CORE),
      ppxPkg(PPX_VER),
    ]);

    const result = await checkUpdates([ANIMATION], {
      fetchImpl,
      catalogAddons: [ANIMATION, PARTICLE],
    });

    // The coherent solve is keyed on the selected set only.
    expect(result.resolved?.packages).not.toHaveProperty(PARTICLE);
    // ...but the informational catalog covers every menu add-on so the picker
    // can show a version next to each row.
    expect(result.catalog).toEqual(
      expect.arrayContaining([
        { addon: ANIMATION, newestPublished: NEW_ADDON },
        { addon: PARTICLE, newestPublished: "1.2.30" },
      ]),
    );
  });
});
