/**
 * features/mcp/verify-tarball.ts — Check a downloaded tarball against its published integrity.
 *
 * The registry publishes `dist.integrity` as `sha512-<base64>`. We verify the
 * downloaded BUFFER before it ever reaches the filesystem, so a poisoned payload
 * cannot be extracted into a Unity project even briefly.
 *
 * The bash original verified nothing at all. Where a package publishes only a
 * weaker hash, or none, this REFUSES rather than degrading: an unverifiable
 * tarball is the one case where failing closed costs nothing.
 */

import { createHash, timingSafeEqual } from "node:crypto";

const SHA512_PREFIX = "sha512-";

/** The `sha512-<base64>` integrity string for a buffer, as the registry publishes it. */
export function integrityOf(payload: Buffer): string {
  return `${SHA512_PREFIX}${createHash("sha512").update(payload).digest("base64")}`;
}

/** Constant-time compare of two base64 digests of the same algorithm. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "base64");
  const right = Buffer.from(b, "base64");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Throw unless `payload` matches the sha512 entry of `integrity`.
 * `label` names the package@version in the error.
 */
export function verifyIntegrity(
  payload: Buffer,
  integrity: string | undefined,
  label: string,
): void {
  if (!integrity) {
    throw new Error(
      `${label}: registry published no integrity hash — refusing to extract an unverifiable tarball`,
    );
  }

  // npm may publish a space-separated set of hashes; take the sha512 one.
  const expected = integrity
    .split(/\s+/)
    .find((entry) => entry.startsWith(SHA512_PREFIX));

  if (!expected) {
    throw new Error(
      `${label}: registry published no sha512 integrity (got '${integrity}') — ` +
        `refusing to extract on a weaker hash`,
    );
  }

  const actual = integrityOf(payload);
  if (!digestsMatch(expected.slice(SHA512_PREFIX.length), actual.slice(SHA512_PREFIX.length))) {
    throw new Error(
      `${label}: tarball integrity MISMATCH — expected ${expected}, got ${actual}. ` +
        `Nothing was written to disk.`,
    );
  }
}
