/**
 * test/lib/unity-version.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { describe, expect, it } from "vitest";
import {
  isUnity6OrNewer,
  parseUnityVersion,
} from "../../src/lib/unity-version.js";

describe("parseUnityVersion", () => {
  it("parses 2022.3.19f1", () => {
    expect(parseUnityVersion("2022.3.19f1")).toEqual({
      major: 2022, minor: 3, patch: "19f1",
    });
  });
  it("parses 6000.0.1f1", () => {
    expect(parseUnityVersion("6000.0.1f1")).toEqual({
      major: 6000, minor: 0, patch: "1f1",
    });
  });
  it("parses 2023.2.5f1", () => {
    expect(parseUnityVersion("2023.2.5f1")).toEqual({
      major: 2023, minor: 2, patch: "5f1",
    });
  });
  it("returns null for unparseable", () => {
    expect(parseUnityVersion("junk")).toBeNull();
    expect(parseUnityVersion("")).toBeNull();
  });
});

describe("isUnity6OrNewer", () => {
  it("true for 6000.x", () => {
    expect(isUnity6OrNewer(parseUnityVersion("6000.0.1f1"))).toBe(true);
  });
  it("false for 2022.x", () => {
    expect(isUnity6OrNewer(parseUnityVersion("2022.3.19f1"))).toBe(false);
  });
  it("false for null", () => {
    expect(isUnity6OrNewer(null)).toBe(false);
  });
});
