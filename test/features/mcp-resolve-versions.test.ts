/**
 * test/features/mcp-resolve-versions.test.ts — Version resolution + the addon pin verdict.
 *
 * The pin verdict is the reason this exists. An addon that does not declare the
 * target core still COMPILES when installed — it fails later as an opaque MCP
 * runtime error. Recording the verdict at fetch is what lets the install gate
 * refuse it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import type { Packument } from "../../src/services/npm-registry.js";
import {
  resolveAddonVersion,
  resolvePpxVersion,
  resolveVersions,
} from "../../src/features/mcp/resolve-versions.js";
import { CORE_PKG, PPX_PKG } from "../../src/features/mcp/mcp-constants.js";

const ANIMATION = "com.ivanmurzak.unity.mcp.animation";

function dist(version: string) {
  return { integrity: `sha512-${version}`, tarball: `https://x/${version}.tgz` };
}

/** A registry the injected fetch serves from, keyed by package name. */
function registry(packuments: Record<string, Packument>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    const pkg = url.split("/").pop()!;
    calls.push(pkg);
    const packument = packuments[pkg];
    if (!packument) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => packument };
  });
  return { fetchImpl, calls };
}

function collectWarns() {
  const warns: string[] = [];
  return {
    reporter: {
      onLog: (entry: { level: string; message: string }) => {
        if (entry.level === "warn") warns.push(entry.message);
      },
    },
    warns,
  };
}

const CORE: Packument = {
  "dist-tags": { latest: "0.82.4" },
  versions: {
    "0.82.3": { dist: dist("0.82.3"), dependencies: { [PPX_PKG]: "2.1.4" } },
    "0.82.4": { dist: dist("0.82.4"), dependencies: { [PPX_PKG]: "2.1.5" } },
  },
};

beforeEach(() => {
  _resetPackumentCache();
});

describe("resolveAddonVersion", () => {
  it("picks the newest addon version that pins the target core", async () => {
    const animation: Packument = {
      versions: {
        "1.2.20": { dist: dist("a"), dependencies: { [CORE_PKG]: "0.82.3" } },
        "1.2.23": { dist: dist("b"), dependencies: { [CORE_PKG]: "0.82.4" } },
        "1.2.24": { dist: dist("c"), dependencies: { [CORE_PKG]: "0.82.4" } },
        "1.3.0": { dist: dist("d"), dependencies: { [CORE_PKG]: "0.83.0" } },
      },
    };
    const { fetchImpl } = registry({ [ANIMATION]: animation });

    const result = await resolveAddonVersion(ANIMATION, "0.82.4", { fetchImpl });

    // 1.3.0 is newer but pins a DIFFERENT core — a pinning match always wins.
    expect(result).toEqual({ name: ANIMATION, version: "1.2.24", pin: true });
  });

  it("falls back to the newest version and records pin:false when none pins the core", async () => {
    const animation: Packument = {
      versions: {
        "1.2.20": { dist: dist("a"), dependencies: { [CORE_PKG]: "0.82.3" } },
        "1.2.24": { dist: dist("c"), dependencies: { [CORE_PKG]: "0.82.3" } },
      },
    };
    const { fetchImpl } = registry({ [ANIMATION]: animation });
    const { reporter, warns } = collectWarns();

    const result = await resolveAddonVersion(ANIMATION, "0.99.0", { fetchImpl, reporter });

    expect(result).toEqual({ name: ANIMATION, version: "1.2.24", pin: false });
    expect(warns.join("\n")).toMatch(/does not pin|no .* pins core/i);
  });

  it("throws when the addon publishes no versions at all", async () => {
    const { fetchImpl } = registry({ [ANIMATION]: { versions: {} } });

    await expect(resolveAddonVersion(ANIMATION, "0.82.4", { fetchImpl })).rejects.toThrow(
      /no versions/,
    );
  });
});

describe("resolvePpxVersion", () => {
  it("uses the exact version the core declares", async () => {
    const { fetchImpl } = registry({ [CORE_PKG]: CORE });

    const result = await resolvePpxVersion("0.82.4", { fetchImpl });

    expect(result).toEqual({ name: PPX_PKG, version: "2.1.5", pin: null });
  });

  it("warns and takes registry latest when the core declares a RANGE", async () => {
    const core: Packument = {
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { dist: dist("x"), dependencies: { [PPX_PKG]: "^2.0.0" } } },
    };
    const ppx: Packument = { "dist-tags": { latest: "2.9.9" }, versions: {} };
    const { fetchImpl } = registry({ [CORE_PKG]: core, [PPX_PKG]: ppx });
    const { reporter, warns } = collectWarns();

    const result = await resolvePpxVersion("1.0.0", { fetchImpl, reporter });

    expect(result.version).toBe("2.9.9");
    expect(warns.join("\n")).toMatch(/range/);
  });

  it("warns and takes registry latest when the core declares no ppx at all", async () => {
    const core: Packument = {
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { dist: dist("x") } },
    };
    const ppx: Packument = { "dist-tags": { latest: "2.9.9" }, versions: {} };
    const { fetchImpl } = registry({ [CORE_PKG]: core, [PPX_PKG]: ppx });
    const { reporter, warns } = collectWarns();

    expect((await resolvePpxVersion("1.0.0", { fetchImpl, reporter })).version).toBe("2.9.9");
    expect(warns.join("\n")).toMatch(/does not declare/);
  });
});

describe("resolveVersions", () => {
  it("returns core + addons + ppx, with pin verdicts", async () => {
    const animation: Packument = {
      versions: { "1.2.24": { dist: dist("c"), dependencies: { [CORE_PKG]: "0.82.4" } } },
    };
    const { fetchImpl } = registry({ [CORE_PKG]: CORE, [ANIMATION]: animation });

    const map = await resolveVersions("0.82.4", [ANIMATION], { fetchImpl });

    expect(map).toEqual([
      { name: CORE_PKG, version: "0.82.4", pin: null },
      { name: ANIMATION, version: "1.2.24", pin: true },
      { name: PPX_PKG, version: "2.1.5", pin: null },
    ]);
  });

  it("reads the core packument once even though core and ppx both need it", async () => {
    const { fetchImpl, calls } = registry({ [CORE_PKG]: CORE });

    await resolveVersions("0.82.4", [], { fetchImpl });

    expect(calls.filter((pkg) => pkg === CORE_PKG)).toHaveLength(1);
  });
});
