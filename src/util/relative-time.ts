/**
 * util/relative-time.ts — Convert a timestamp in milliseconds to a human-readable
 * relative time string (e.g. "just now", "5m ago", "2h ago", "3d ago").
 *
 * Ported from sync-unity wholesale.
 */

const MINUTE = 60_000;
const HOUR   = 3_600_000;
const DAY    = 86_400_000;

/**
 * Return a relative time string for a timestamp (ms epoch).
 * The age is computed as `Date.now() - ms`.
 */
export function relativeTime(ms: number): string {
  const age = Date.now() - ms;

  if (age < MINUTE) return "just now";
  if (age < HOUR)   return `${Math.floor(age / MINUTE)}m ago`;
  if (age < DAY)    return `${Math.floor(age / HOUR)}h ago`;
  return `${Math.floor(age / DAY)}d ago`;
}
