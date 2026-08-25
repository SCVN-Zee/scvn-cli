/**
 * test/features/bundled-node-paths.test.ts — Layout contract for the bundled Node runtime.
 *
 * Pins the exact `node/bin/node` literal the bash wrapper (bin/scvn) hardcodes — if either side
 * drifts, this fails. (The wrapper-side string is cross-checked in the Phase 3 wrapper test.)
 */

import { describe, it, expect } from "vitest";
import {
  BUNDLED_NODE_DIRNAME,
  BUNDLED_NODE_SUBPATH,
  bundledNodeBinPath,
} from "../../src/features/pack/bundled-node-paths.js";

describe("bundled-node-paths (layout contract)", () => {
  it("exposes the dir + subpath the producer writes and the wrapper reads", () => {
    expect(BUNDLED_NODE_DIRNAME).toBe("node");
    expect(BUNDLED_NODE_SUBPATH).toBe("node/bin/node");
  });

  it("bundledNodeBinPath joins the subpath onto the install root", () => {
    expect(bundledNodeBinPath("/x")).toBe("/x/node/bin/node");
    expect(bundledNodeBinPath("/opt/scvn-bundle")).toBe("/opt/scvn-bundle/node/bin/node");
  });
});
