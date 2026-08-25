/**
 * test/util/store-override.test.ts — Unit tests for the store-dir override resolver.
 *
 * Precedence: --store flag › SCVN_STORE_DIR env › none. Empty-string env is unset.
 */

import { describe, it, expect } from "vitest";
import { resolveStoreOverride } from "../../src/util/store-override.js";

describe("resolveStoreOverride", () => {
  it("prefers the flag over the env", () => {
    expect(resolveStoreOverride("/a", "/b")).toBe("/a");
  });

  it("uses the env when no flag is given", () => {
    expect(resolveStoreOverride(undefined, "/b")).toBe("/b");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveStoreOverride(undefined, undefined)).toBeUndefined();
  });

  it("treats an empty-string env as unset", () => {
    expect(resolveStoreOverride(undefined, "")).toBeUndefined();
  });

  it("defaults env to process.env.SCVN_STORE_DIR", () => {
    const prev = process.env["SCVN_STORE_DIR"];
    process.env["SCVN_STORE_DIR"] = "/from-env";
    try {
      expect(resolveStoreOverride()).toBe("/from-env");
      expect(resolveStoreOverride("/flag")).toBe("/flag");
    } finally {
      if (prev === undefined) delete process.env["SCVN_STORE_DIR"];
      else process.env["SCVN_STORE_DIR"] = prev;
    }
  });
});
