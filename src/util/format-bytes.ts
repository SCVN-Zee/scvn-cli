/**
 * util/format-bytes.ts — Human-readable byte size formatter.
 *
 * formatBytes(n) → "1.2 MB", "830 KB", "512 B"
 */

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  const unit = units[exp] ?? "B";
  const formatted = exp === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${formatted} ${unit}`;
}
