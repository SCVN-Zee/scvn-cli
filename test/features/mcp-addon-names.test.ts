/**
 * test/features/mcp-addon-names.test.ts — `--addons` CSV expansion.
 *
 * Bare shorthand expands into the com.ivanmurzak.unity.mcp.* namespace; a
 * fully-qualified name passes through.
 */

import { describe, it, expect } from "vitest";
import { expandAddonCsv } from "../../src/features/mcp/addon-names.js";

describe("expandAddonCsv", () => {
  it("expands bare shorthand into the addon namespace", () => {
    expect(expandAddonCsv("animation,particlesystem")).toEqual([
      "com.ivanmurzak.unity.mcp.animation",
      "com.ivanmurzak.unity.mcp.particlesystem",
    ]);
  });

  it("passes a fully-qualified name through", () => {
    expect(expandAddonCsv("com.ivanmurzak.unity.mcp.animation")).toEqual([
      "com.ivanmurzak.unity.mcp.animation",
    ]);
  });

  it("tolerates whitespace and empty entries", () => {
    expect(expandAddonCsv(" animation , , particlesystem ")).toEqual([
      "com.ivanmurzak.unity.mcp.animation",
      "com.ivanmurzak.unity.mcp.particlesystem",
    ]);
  });

  it("dedupes while preserving order", () => {
    expect(expandAddonCsv("animation,animation")).toEqual([
      "com.ivanmurzak.unity.mcp.animation",
    ]);
  });

  it("returns [] for an empty CSV", () => {
    expect(expandAddonCsv("")).toEqual([]);
    expect(expandAddonCsv("  ")).toEqual([]);
  });

  it("expands cinemachine like any other addon", () => {
    expect(expandAddonCsv("cinemachine")).toEqual(["com.ivanmurzak.unity.mcp.cinemachine"]);
  });

  it("passes a fully-qualified cinemachine through", () => {
    expect(expandAddonCsv("com.ivanmurzak.unity.mcp.cinemachine")).toEqual([
      "com.ivanmurzak.unity.mcp.cinemachine",
    ]);
  });

  it("expands cinemachine alongside another addon", () => {
    expect(expandAddonCsv("animation,cinemachine")).toEqual([
      "com.ivanmurzak.unity.mcp.animation",
      "com.ivanmurzak.unity.mcp.cinemachine",
    ]);
  });
});
