/**
 * test/services/npm-registry.test.ts — Packument fetching against both registries.
 *
 * OpenUPM and npm speak the same protocol, so one client serves both. The
 * per-run cache matters: resolving core + 2 addons + ppx would otherwise refetch
 * the core packument three times.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  fetchPackument,
  latestVersion,
  distOf,
  dependenciesOf,
  _resetPackumentCache,
  OPENUPM_REGISTRY,
  NPM_REGISTRY,
} from "../../src/services/npm-registry.js";
import type { Packument } from "../../src/services/npm-registry.js";

const CORE: Packument = {
  "dist-tags": { latest: "0.82.4" },
  versions: {
    "0.82.3": { dist: { integrity: "sha512-old", tarball: "https://x/old.tgz" } },
    "0.82.4": {
      dist: { integrity: "sha512-new", tarball: "https://x/new.tgz" },
      dependencies: { "extensions.unity.playerprefsex": "2.1.5" },
    },
  },
};

function jsonFetch(body: unknown, ok = true, status = 200) {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

beforeEach(() => {
  _resetPackumentCache();
});

describe("fetchPackument", () => {
  it("fetches <base>/<pkg> and returns the packument", async () => {
    const fetchImpl = jsonFetch(CORE);

    const result = await fetchPackument(OPENUPM_REGISTRY, "com.ivanmurzak.unity.mcp", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(`${OPENUPM_REGISTRY}/com.ivanmurzak.unity.mcp`);
    expect(result["dist-tags"]?.latest).toBe("0.82.4");
  });

  it("caches per (base, pkg) — a second call does not re-fetch", async () => {
    const fetchImpl = jsonFetch(CORE);

    await fetchPackument(OPENUPM_REGISTRY, "pkg", { fetchImpl });
    await fetchPackument(OPENUPM_REGISTRY, "pkg", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keys the cache on the registry, not just the package name", async () => {
    const fetchImpl = jsonFetch(CORE);

    await fetchPackument(OPENUPM_REGISTRY, "pkg", { fetchImpl });
    await fetchPackument(NPM_REGISTRY, "pkg", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws naming the package and the registry on a non-OK response", async () => {
    const fetchImpl = jsonFetch({}, false, 404);

    await expect(fetchPackument(OPENUPM_REGISTRY, "nope", { fetchImpl })).rejects.toThrow(/nope/);
    await expect(fetchPackument(OPENUPM_REGISTRY, "nope", { fetchImpl })).rejects.toThrow(/404/);
  });

  it("does not cache a failure — a retry re-fetches", async () => {
    const failing = jsonFetch({}, false, 503);
    await expect(fetchPackument(OPENUPM_REGISTRY, "pkg", { fetchImpl: failing })).rejects.toThrow();

    const succeeding = jsonFetch(CORE);
    const result = await fetchPackument(OPENUPM_REGISTRY, "pkg", { fetchImpl: succeeding });

    expect(result["dist-tags"]?.latest).toBe("0.82.4");
  });
});

describe("packument accessors", () => {
  it("reads dist-tags.latest", () => {
    expect(latestVersion(CORE, "core")).toBe("0.82.4");
  });

  it("throws when dist-tags.latest is missing", () => {
    expect(() => latestVersion({ versions: {} }, "core")).toThrow(/core/);
  });

  it("reads a version's dist block", () => {
    expect(distOf(CORE, "0.82.4", "core").tarball).toBe("https://x/new.tgz");
  });

  it("throws when the version is absent from the packument", () => {
    expect(() => distOf(CORE, "9.9.9", "core")).toThrow(/9\.9\.9/);
  });

  it("reads a version's dependencies, defaulting to {}", () => {
    expect(dependenciesOf(CORE, "0.82.4")["extensions.unity.playerprefsex"]).toBe("2.1.5");
    expect(dependenciesOf(CORE, "0.82.3")).toEqual({});
    expect(dependenciesOf(CORE, "9.9.9")).toEqual({});
  });
});
