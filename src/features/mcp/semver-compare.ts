/**
 * features/mcp/semver-compare.ts — SemVer precedence, without a dependency.
 *
 * Ports the bash `vkey` tuple (unity-mcp-localize.sh:350). Two behaviors are
 * load-bearing: version parts compare NUMERICALLY (0.82.10 > 0.82.4, which a
 * string sort gets backwards), and a release outranks any prerelease of the
 * same release (1.0.0 > 1.0.0-rc.1).
 *
 * `caretSatisfies` picks the concrete version for a dependency range while
 * resolving the offline `unity-mcp-cli` closure. It proves only the range shapes
 * npm actually publishes there (^, ~, exact, *) and returns false for anything
 * it cannot prove, so an unrecognized range degrades to a warn + fallback rather
 * than a wrong pick.
 */

/** A prerelease identifier: numeric ones rank below alphanumeric ones (SemVer §11). */
type PreId = readonly [kind: 0 | 1, value: number | string];

interface VersionKey {
  release: number[];
  /** null for a release — ranks above every prerelease of the same release. */
  prerelease: PreId[] | null;
}

const NUMERIC = /^\d+$/;

function parseKey(version: string): VersionKey {
  const trimmed = version.trim();
  const dash = trimmed.indexOf("-");
  const releasePart = dash === -1 ? trimmed : trimmed.slice(0, dash);
  const prePart = dash === -1 ? null : trimmed.slice(dash + 1);

  const release = releasePart
    .split(".")
    .map((part) => (NUMERIC.test(part) ? Number(part) : 0));

  const prerelease =
    prePart === null
      ? null
      : prePart.split(".").map((part): PreId =>
          NUMERIC.test(part) ? [0, Number(part)] : [1, part],
        );

  return { release, prerelease };
}

function compareNumberLists(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function comparePrerelease(a: PreId[], b: PreId[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i];
    const right = b[i];
    // A shorter set of identifiers ranks lower (1.0.0-rc < 1.0.0-rc.1).
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    if (left[1] === right[1]) continue;
    // Same kind, so the values are both numbers or both strings — never crossed.
    return left[1] < right[1] ? -1 : 1;
  }
  return 0;
}

/** -1 / 0 / 1 by SemVer precedence. */
export function compareVersions(a: string, b: string): number {
  const left = parseKey(a);
  const right = parseKey(b);

  const byRelease = compareNumberLists(left.release, right.release);
  if (byRelease !== 0) return byRelease;

  if (left.prerelease === null && right.prerelease === null) return 0;
  if (left.prerelease === null) return 1; // release beats prerelease
  if (right.prerelease === null) return -1;

  return comparePrerelease(left.prerelease, right.prerelease);
}

/** Highest version by SemVer precedence, or null for an empty list. */
export function semverMax(versions: readonly string[]): string | null {
  let best: string | null = null;
  for (const version of versions) {
    const candidate = version.trim();
    if (!candidate) continue;
    if (best === null || compareVersions(candidate, best) > 0) best = candidate;
  }
  return best;
}

/** True for `1.0.0-rc.1` and friends; false for a plain release. */
export function isPrerelease(version: string): boolean {
  return parseKey(version).prerelease !== null;
}

/** Upper bound (exclusive) of a caret range: the left-most non-zero part is pinned. */
function caretCeiling(floor: number[]): number[] {
  const [major = 0, minor = 0, patch = 0] = floor;
  if (major !== 0) return [major + 1, 0, 0];
  if (minor !== 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

/**
 * Whether `version` satisfies `range`. Handles `^`, `~`, an exact pin, and
 * `*`/empty; every other shape returns false (unprovable, not "no").
 *
 * Prereleases never satisfy a stable range — npm's rule, and the reason a beta
 * cannot slip into the bundled CLI closure.
 */
export function caretSatisfies(range: string, version: string): boolean {
  const spec = range.trim();
  const candidate = version.trim();

  if (spec === "" || spec === "*" || spec === "x") return !isPrerelease(candidate);
  if (isPrerelease(candidate)) return false;

  const operator = spec[0];
  if (operator === "^" || operator === "~") {
    const floorSpec = spec.slice(1).trim();
    if (!/^\d/.test(floorSpec)) return false;
    const floor = parseKey(floorSpec).release;
    const target = parseKey(candidate).release;
    if (compareNumberLists(target, floor) < 0) return false;

    const [major = 0, minor = 0] = floor;
    const ceiling =
      operator === "^" ? caretCeiling(floor) : [major, minor + 1, 0];
    return compareNumberLists(target, ceiling) < 0;
  }

  // A bare version is an exact pin (OpenUPM's core→ppx dependency shape).
  if (/^\d/.test(spec)) return compareVersions(spec, candidate) === 0;

  return false;
}
