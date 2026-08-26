/**
 * test/features/desktop-tab-selection.test.ts — Renderer tab visibility.
 *
 * `SCVN_TABS` is visibility-only: it selects which tabs the sidebar shows by
 * default (the ⌘⇧. reveal exposes the rest). It no longer gates host commands —
 * every capability handler is registered regardless — so these cover just the
 * pure catalog filter that drives sidebar visibility.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  parseTabSelection,
  filterCapabilities,
} from "../../desktop/shared/commands.js";

describe("parseTabSelection", () => {
  it("returns null for an unset/empty/whitespace selection (ship all)", () => {
    expect(parseTabSelection("")).toBeNull();
    expect(parseTabSelection("   ")).toBeNull();
    expect(parseTabSelection(" , ,")).toBeNull();
  });

  it("splits, trims, and drops blanks", () => {
    expect(parseTabSelection(" fork , git ,, mcp")).toEqual(["fork", "git", "mcp"]);
  });
});

describe("filterCapabilities", () => {
  it("returns the full catalog when no selection is set", () => {
    expect(filterCapabilities(ALL_CAPABILITIES, "")).toBe(ALL_CAPABILITIES);
  });

  it("keeps only selected tabs, in menu order regardless of selection order", () => {
    const picked = filterCapabilities(ALL_CAPABILITIES, "git,fork");
    expect(picked.map((c) => c.id)).toEqual(["fork", "git"]);
  });

  it("ignores unknown ids", () => {
    const picked = filterCapabilities(ALL_CAPABILITIES, "fork,nope");
    expect(picked.map((c) => c.id)).toEqual(["fork"]);
  });
});
