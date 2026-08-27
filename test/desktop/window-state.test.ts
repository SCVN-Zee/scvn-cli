/**
 * test/desktop/window-state.test.ts — Pure parse/default/clamp for the
 * BrowserWindow restore contract. No Electron.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampWindowState,
  defaultWindowState,
  parseWindowState,
  windowStateFromBounds,
  type Rect,
} from "../../desktop/main/window-state.js";

const laptop: Rect = { x: 0, y: 25, width: 1440, height: 875 };

describe("defaultWindowState", () => {
  it("is 1224×918, not maximized, no position", () => {
    expect(defaultWindowState()).toEqual({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      isMaximized: false,
    });
    expect(DEFAULT_WINDOW_WIDTH).toBe(1224);
    expect(DEFAULT_WINDOW_HEIGHT).toBe(918);
  });
});

describe("parseWindowState", () => {
  it("returns null for missing or corrupt payloads", () => {
    expect(parseWindowState(undefined)).toBeNull();
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState("1224")).toBeNull();
    expect(parseWindowState([])).toBeNull();
    expect(parseWindowState({ width: "1224", height: 918 })).toBeNull();
    expect(parseWindowState({ width: NaN, height: 918 })).toBeNull();
    expect(parseWindowState({ width: 0, height: 918 })).toBeNull();
    expect(parseWindowState({ width: -10, height: 918 })).toBeNull();
    expect(parseWindowState({ height: 918 })).toBeNull();
  });

  it("accepts size-only JSON and optional geometry", () => {
    expect(parseWindowState({ width: 1400, height: 900 })).toEqual({
      width: 1400,
      height: 900,
      isMaximized: false,
    });
    expect(
      parseWindowState({ x: 80.4, y: 60.6, width: 1400.2, height: 900.8, isMaximized: true }),
    ).toEqual({
      x: 80,
      y: 61,
      width: 1400,
      height: 901,
      isMaximized: true,
    });
  });

  it("ignores a lone x or y so a partial position cannot restore off-origin", () => {
    expect(parseWindowState({ x: 10, width: 1224, height: 918 })).toEqual({
      width: 1224,
      height: 918,
      isMaximized: false,
    });
  });
});

describe("clampWindowState", () => {
  it("floors to the existing min size", () => {
    const clamped = clampWindowState({ width: 100, height: 50, isMaximized: false }, [laptop]);
    expect(clamped.width).toBe(MIN_WINDOW_WIDTH);
    expect(clamped.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it("does not invent x/y for size-only state", () => {
    const clamped = clampWindowState({ width: 1400, height: 900, isMaximized: false }, [laptop]);
    expect(clamped).toEqual({ width: 1400, height: 900, isMaximized: false });
    expect("x" in clamped).toBe(false);
    expect("y" in clamped).toBe(false);
  });

  it("keeps the 1224×918 default even when taller than the work area", () => {
    expect(clampWindowState(defaultWindowState(), [laptop])).toEqual({
      width: 1224,
      height: 918,
      isMaximized: false,
    });
  });

  it("keeps a visible window in place", () => {
    expect(
      clampWindowState({ x: 100, y: 80, width: 1224, height: 800, isMaximized: false }, [laptop]),
    ).toEqual({ x: 100, y: 80, width: 1224, height: 800, isMaximized: false });
  });

  it("relocates a fully off-screen origin onto a visible work area without resetting size", () => {
    const clamped = clampWindowState(
      { x: 8000, y: 4000, width: 1224, height: 800, isMaximized: false },
      [laptop],
    );
    expect(clamped.width).toBe(1224);
    expect(clamped.height).toBe(800);
    expect(clamped.x).toBeGreaterThanOrEqual(laptop.x);
    expect(clamped.y).toBeGreaterThanOrEqual(laptop.y);
    expect((clamped.x ?? 0) + clamped.width).toBeLessThanOrEqual(laptop.x + laptop.width);
    expect((clamped.y ?? 0) + clamped.height).toBeLessThanOrEqual(laptop.y + laptop.height);
  });

  it("caps an oversized window to the work area", () => {
    const clamped = clampWindowState(
      { x: 0, y: 25, width: 4000, height: 3000, isMaximized: true },
      [laptop],
    );
    expect(clamped.width).toBe(laptop.width);
    expect(clamped.height).toBe(laptop.height);
    expect(clamped.isMaximized).toBe(true);
  });

  it("floors without displays and preserves a provided position", () => {
    expect(
      clampWindowState({ x: 10, y: 20, width: 100, height: 100, isMaximized: false }, []),
    ).toEqual({ x: 10, y: 20, width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT, isMaximized: false });
  });
});

describe("windowStateFromBounds", () => {
  it("rounds and floors when snapshotting a save", () => {
    expect(
      windowStateFromBounds({ x: 10.4, y: 20.6, width: 100.2, height: 50.8 }, true),
    ).toEqual({
      x: 10,
      y: 21,
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
      isMaximized: true,
    });
  });
});
