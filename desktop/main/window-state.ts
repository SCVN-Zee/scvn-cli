/**
 * desktop/main/window-state.ts — Parse, default, and clamp BrowserWindow geometry.
 *
 * Pure: no Electron, no filesystem. Main-process I/O lives in index.ts so
 * unit tests can cover the restore contract without booting Electron.
 */

export const DEFAULT_WINDOW_WIDTH = 1224;
export const DEFAULT_WINDOW_HEIGHT = 918;
export const MIN_WINDOW_WIDTH = 600;
export const MIN_WINDOW_HEIGHT = 560;

/** A display work area or window bounds rectangle, in DIP (logical pixels). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export function defaultWindowState(): WindowState {
  return {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    isMaximized: false,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Accept a JSON-shaped payload. Returns null when the caller should fall back
 * to `defaultWindowState()` (missing, corrupt, or non-positive size).
 * Undersized-but-valid numbers are kept here and floored in `clampWindowState`.
 */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (!isFiniteNumber(rec.width) || !isFiniteNumber(rec.height)) return null;
  if (rec.width <= 0 || rec.height <= 0) return null;

  const state: WindowState = {
    width: Math.round(rec.width),
    height: Math.round(rec.height),
    isMaximized: rec.isMaximized === true,
  };
  if (isFiniteNumber(rec.x) && isFiniteNumber(rec.y)) {
    state.x = Math.round(rec.x);
    state.y = Math.round(rec.y);
  }
  return state;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function clampNumber(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(n, min), max);
}

function capSize(width: number, height: number, area: Rect): { width: number; height: number } {
  return {
    width: clampNumber(width, MIN_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, area.width)),
    height: clampNumber(height, MIN_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, area.height)),
  };
}

function largestArea(workAreas: Rect[]): Rect {
  return workAreas.reduce((best, area) =>
    area.width * area.height > best.width * best.height ? area : best,
  );
}

/**
 * Floor to the min size, cap to a visible work area, and relocate a fully
 * off-screen origin. Size-only state (no x/y) never invents a position.
 */
export function clampWindowState(state: WindowState, workAreas: Rect[]): WindowState {
  const width = Math.max(MIN_WINDOW_WIDTH, Math.round(state.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(state.height));
  const isMaximized = state.isMaximized === true;

  if (workAreas.length === 0 || state.x === undefined || state.y === undefined) {
    // Size-only (first launch / no saved origin) must keep the requested size —
    // including the 1224×918 default — and must not invent x/y.
    return { ...omitPositionIfMissing(state), width, height, isMaximized };
  }

  const candidate: Rect = { x: state.x, y: state.y, width, height };
  const area = workAreas.find((workArea) => intersects(candidate, workArea)) ?? largestArea(workAreas);
  const capped = capSize(width, height, area);
  return {
    x: clampNumber(candidate.x, area.x, area.x + area.width - capped.width),
    y: clampNumber(candidate.y, area.y, area.y + area.height - capped.height),
    width: capped.width,
    height: capped.height,
    isMaximized,
  };
}

function omitPositionIfMissing(state: WindowState): Pick<WindowState, "x" | "y"> {
  return state.x === undefined || state.y === undefined ? {} : { x: state.x, y: state.y };
}

/** Snapshot used when writing prefs (`getNormalBounds()` while zoomed). */
export function windowStateFromBounds(bounds: Rect, isMaximized: boolean): WindowState {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(MIN_WINDOW_WIDTH, Math.round(bounds.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, Math.round(bounds.height)),
    isMaximized,
  };
}
