/**
 * test/lib/path-expand.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { expandHome, compactHome } from "../../src/lib/path-expand.js";

describe("expandHome", () => {
  it("expands lone ~", () => {
    expect(expandHome("~")).toBe(homedir());
  });
  it("expands ~/sub", () => {
    expect(expandHome("~/projects")).toBe(homedir() + "/projects");
  });
  it("leaves absolute paths alone", () => {
    expect(expandHome("/tmp/foo")).toBe("/tmp/foo");
  });
  it("does not expand mid-string ~", () => {
    expect(expandHome("/tmp/~/foo")).toBe("/tmp/~/foo");
  });
});

describe("compactHome", () => {
  it("compacts exact homedir to ~", () => {
    expect(compactHome(homedir())).toBe("~");
  });
  it("compacts homedir prefix to ~/...", () => {
    expect(compactHome(homedir() + "/projects")).toBe("~/projects");
  });
  it("leaves non-home paths untouched", () => {
    expect(compactHome("/tmp/foo")).toBe("/tmp/foo");
  });
  it("does not compact paths that share homedir prefix without separator", () => {
    expect(compactHome(homedir() + "extra")).toBe(homedir() + "extra");
  });
});
