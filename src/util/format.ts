/**
 * util/format.ts — Human-readable formatting helpers for progress display.
 *
 * formatBytes(n)          → "1.2 MB", "830 KB", "512 B"
 * formatRate(bytesPerSec) → "1.2 MB/s", "830 KB/s"
 * formatEta(seconds)      → "1h 23m", "4m 32s", "45s", "< 1s"
 *
 * Ported from sync-unity. formatBytes lives in util/format-bytes.ts and is
 * re-exported here for callers that already use util/format.ts as a single import surface.
 */

export { formatBytes } from "./format-bytes.js";

// ---------------------------------------------------------------------------
// formatRate
// ---------------------------------------------------------------------------

export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytesPerSec) / Math.log(1024)),
    units.length - 1
  );
  const value = bytesPerSec / Math.pow(1024, exponent);
  const unit = units[exponent] ?? "B/s";
  const formatted = exponent === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${formatted} ${unit}`;
}

// ---------------------------------------------------------------------------
// formatEta
// ---------------------------------------------------------------------------

export function formatEta(seconds: number): string {
  if (seconds <= 0) return "< 1s";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}
