/**
 * test/features/mcp-resolve-coherent-core.test.ts — Solving the core against the addons.
 *
 * The headline case is the one that shipped broken: upstream publishes a core,
 * the addons have no build for it yet, and dist-tags.latest names a version that
 * cannot be installed. Picking it anyway cost a four-tarball download and an
 * install-gate refusal, on the DEFAULT path, after every core release.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import type { Packument } from "../../src/services/npm-registry.js";
import {
  resolveCoherentCore,
  NoCoherentCoreError,
} from "../../src/features/mcp/resolve-coherent-core.js";
import { CORE_PKG } from "../../src/features/mcp/mcp-constants.js";

const ANIMATION = "com.ivanmurzak.unity.mcp.animation";
const PARTICLE = "com.ivanmurzak.unity.mcp.particlesystem";

function dist(version: string) {
  return { integrity: `sha512-${version}`, tarball: `https://x/${version}.tgz` };
}

function registry(packuments: Record<string, Packument>) {
  const fetchImpl = vi.fn(async (url: string) => {
    const packument = packuments[url.split("/").pop()!];
    if (!packument) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => packument };
  });
  return { fetchImpl };
}

/** An addon packument: version → the core it pins. */
function addon(pins: Record<string, string>): Packument {
  const versions: Packument["versions"] = {};
  for (const [version, core] of Object.entries(pins)) {
    versions[version] = { dist: dist(version), dependencies: { [CORE_PKG]: core } };
  }
  return { versions };
}

/** A core packument publishing `versions`, with the last as dist-tags.latest. */
function core(...versions: string[]): Packument {
  const published: Packument["versions"] = {};
  for (const version of versions) published[version] = { dist: dist(version) };
  return { "dist-tags": { latest: versions.at(-1)! }, versions: published };
}

function collect() {
  const logs: Array<{ level: string; message: string }> = [];
  return { reporter: { onLog: (entry: { level: string; message: string }) => logs.push(entry) }, logs };
}

beforeEach(() => {
  _resetPackumentCache();
});

describe("resolveCoherentCore", () => {
  it("skips a newer core that no addon has a build for yet", async () => {
    // The real shape: core ships 0.84.x, addons still only pin 0.83.1.
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.0", "0.84.2"),
      [ANIMATION]: addon({ "1.2.24": "0.82.4", "1.2.25": "0.83.1" }),
      [PARTICLE]: addon({ "1.2.24": "0.82.4", "1.2.25": "0.83.1" }),
    });
    const { reporter, logs } = collect();

    expect(await resolveCoherentCore([ANIMATION, PARTICLE], { fetchImpl, reporter })).toBe("0.83.1");
    expect(logs.map((entry) => entry.message).join("\n")).toMatch(/0\.84\.2.*newest published/);
  });

  it("takes dist-tags.latest when the addons DO pin it, and says nothing", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2" }),
    });
    const { reporter, logs } = collect();

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl, reporter })).toBe("0.84.2");
    expect(logs).toEqual([]);
  });

  it("intersects across addons — the SET has to agree, not just one member", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2", "1.2.25": "0.83.1" }), // could do 0.84.2
      [PARTICLE]: addon({ "1.2.25": "0.83.1" }), // cannot
    });

    expect(await resolveCoherentCore([ANIMATION, PARTICLE], { fetchImpl })).toBe("0.83.1");
  });

  it("solves per REQUEST — dropping the lagging addon unlocks the newer core", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2", "1.2.25": "0.83.1" }),
      [PARTICLE]: addon({ "1.2.25": "0.83.1" }),
    });

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl })).toBe("0.84.2");
  });

  it("ignores a pin naming a core the registry no longer publishes", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1"), // 0.84.2 was yanked
      [ANIMATION]: addon({ "1.2.26": "0.84.2", "1.2.25": "0.83.1" }),
    });

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl })).toBe("0.83.1");
  });

  it("resolves to dist-tags.latest when no addons are requested", async () => {
    const { fetchImpl } = registry({ [CORE_PKG]: core("0.83.1", "0.84.2") });

    expect(await resolveCoherentCore([], { fetchImpl })).toBe("0.84.2");
  });

  it.each([
    ["^0.84.0", "caret"],
    ["~0.84.0", "tilde"],
    ["0.83.1 || 0.84.2", "digit-leading OR"],
    ["0.83.1 - 0.84.2", "digit-leading hyphen range"],
    ["0.83.1 <0.85.0", "digit-leading compound"],
    ["*", "wildcard"],
  ])("treats %s (%s) as a range that constrains nothing, not a pin", async (declared) => {
    // A digit-leading RANGE is the trap: read as a literal pin it matches nothing
    // published, empties the intersection, and hard-blocks over an addon that
    // supports MORE cores, not fewer.
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: {
        versions: { "1.2.26": { dist: dist("a"), dependencies: { [CORE_PKG]: declared } } },
      },
    });

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl })).toBe("0.84.2");
  });

  it("never lands on a prerelease core on the unnamed path", async () => {
    // semverMax ranks 0.85.0-rc.1 above 0.84.2 — a bare install must not take it
    // just because an addon happened to pin it.
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.84.2", "0.85.0-rc.1"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2", "1.3.0-rc.1": "0.85.0-rc.1" }),
    });

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl })).toBe("0.84.2");
  });

  it("blames the registry, not the addons, for a packument with no versions", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: { "dist-tags": { latest: "0.84.2" }, versions: {} },
      [ANIMATION]: addon({ "1.2.25": "0.83.1" }),
    });

    await expect(resolveCoherentCore([ANIMATION], { fetchImpl })).rejects.toThrow(
      /publishes no stable versions/,
    );
  });

  it("lets an addon declaring a RANGE constrain nothing rather than block everything", async () => {
    // Unknown is not "impossible": a shape we cannot prove must not hard-block an
    // install. The pin gate still gets its say downstream.
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: {
        versions: { "1.2.26": { dist: dist("a"), dependencies: { [CORE_PKG]: "^0.84.0" } } },
      },
    });
    const { reporter, logs } = collect();

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl, reporter })).toBe("0.84.2");
    expect(logs.map((entry) => entry.message).join("\n")).toMatch(/no exact.*pin/);
  });

  it("throws NoCoherentCoreError — distinctly — when the set shares no core", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2" }),
      [PARTICLE]: addon({ "1.2.25": "0.83.1" }),
    });

    const boom = resolveCoherentCore([ANIMATION, PARTICLE], { fetchImpl });

    // The TYPE matters: install's offline fallback keys off it to avoid burying a
    // real conflict under "registry unreachable".
    await expect(boom).rejects.toBeInstanceOf(NoCoherentCoreError);
    await expect(boom).rejects.toThrow(/no core version has a build of every requested addon/);
  });

  it("--force accepts a skewed core when the set shares none", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.26": "0.84.2" }),
      [PARTICLE]: addon({ "1.2.25": "0.83.1" }),
    });
    const { reporter, logs } = collect();

    expect(
      await resolveCoherentCore([ANIMATION, PARTICLE], { fetchImpl, force: true, reporter }),
    ).toBe("0.84.2");
    expect(logs.map((entry) => entry.message).join("\n")).toMatch(/--force.*runtime/s);
  });

  it("--force still PREFERS a coherent core when one exists", async () => {
    const { fetchImpl } = registry({
      [CORE_PKG]: core("0.83.1", "0.84.2"),
      [ANIMATION]: addon({ "1.2.25": "0.83.1" }),
    });

    expect(await resolveCoherentCore([ANIMATION], { fetchImpl, force: true })).toBe("0.83.1");
  });
});
