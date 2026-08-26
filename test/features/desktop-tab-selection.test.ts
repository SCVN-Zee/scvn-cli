/**
 * test/features/desktop-tab-selection.test.ts — Build-time tab selection.
 *
 * Covers the pure catalog filter (SCVN_TABS → visible tabs), the pure host
 * registry filter (SCVN_TABS → invokable commands), and — critically — the
 * drift guard that keeps TAB_COMMAND_KEYS in sync with the real handler
 * registry so a hidden tab's commands are genuinely not invokable.
 */

import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  parseTabSelection,
  filterCapabilities,
} from "../../desktop/shared/commands.js";
import {
  TAB_COMMAND_KEYS,
  SHARED_COMMAND_KEYS,
  selectRegistry,
} from "../../desktop/shared/tab-commands.js";
import { capabilities } from "../../desktop/host/capabilities.js";

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

describe("selectRegistry", () => {
  const fakeRegistry: Record<string, string> = {
    ping: "ping",
    "projects:discover": "shared",
    fork: "fork",
    "fork:prepare": "fork",
    git: "git",
    "templates:read": "git",
    config: "settings",
    doctor: "settings",
  };

  it("keeps every key when all tabs are enabled", () => {
    const out = selectRegistry(fakeRegistry, ALL_CAPABILITIES.map((c) => c.id));
    expect(Object.keys(out).sort()).toEqual(Object.keys(fakeRegistry).sort());
  });

  it("drops keys owned by disabled tabs but keeps shared + enabled keys", () => {
    const out = selectRegistry(fakeRegistry, ["fork"]);
    // templates:read is shared (Git ops + Fork merge field), so it survives a
    // subset build that disables the Git tab — never stripped from the survivor.
    expect(Object.keys(out).sort()).toEqual(
      ["fork", "fork:prepare", "ping", "projects:discover", "templates:read"].sort(),
    );
    expect(out["templates:read"]).toBe("git");
    // Disabled tabs' commands are gone → dispatcher returns UnknownCommand.
    expect(out["git"]).toBeUndefined();
    expect(out["config"]).toBeUndefined();
  });
});

describe("tab-command ownership is complete (drift guard)", () => {
  it("maps exactly the CAPABILITIES ids", () => {
    expect(Object.keys(TAB_COMMAND_KEYS).sort()).toEqual(
      ALL_CAPABILITIES.map((c) => c.id).sort(),
    );
  });

  it("assigns every real registry command to a tab or the shared set", () => {
    const owned = new Set<string>(SHARED_COMMAND_KEYS);
    for (const keys of Object.values(TAB_COMMAND_KEYS)) {
      for (const key of keys) owned.add(key);
    }
    // `ping` is added by registry.ts, not capabilities.ts; the rest must all be
    // classified so tab selection can never leave an orphaned invokable command.
    const unclassified = Object.keys(capabilities).filter((key) => !owned.has(key));
    expect(unclassified).toEqual([]);
  });

  it("does not map any command absent from the real registry", () => {
    const real = new Set<string>(["ping", ...Object.keys(capabilities)]);
    const mapped = [
      ...SHARED_COMMAND_KEYS,
      ...Object.values(TAB_COMMAND_KEYS).flat(),
    ];
    const stale = mapped.filter((key) => !real.has(key));
    expect(stale).toEqual([]);
  });
});
