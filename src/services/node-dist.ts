/**
 * services/node-dist.ts — Download + verify + cache a pinned Node runtime for `make pack`.
 *
 * Produces the macOS Node binary that `make pack` bundles. Integrity is anchored on a SHA-256
 * PINNED IN SOURCE — not a SHASUMS file fetched over the same channel an attacker could control.
 * The download is published to the cache atomically (temp staging + rename) and re-verified on
 * every cache hit, so a corrupt or poisoned binary can never silently ship.
 *
 * Network is injectable (`fetchImpl`, default global fetch) so tests never hit the wire.
 */

import path from "node:path";
import { createHash } from "node:crypto";
import {
  mkdtemp, mkdir, rm, rename, writeFile, readFile, chmod, stat,
} from "node:fs/promises";
import { execa } from "execa";

export type DarwinArch = "arm64" | "x64";

/** Pinned Node version bundled by `make pack`. Explicit patch — never "latest". */
export const PINNED_NODE_VERSION = "24.16.0";

/**
 * SHA-256 of each `node-v<PINNED>-darwin-<arch>.tar.gz`, pinned in source so integrity does NOT
 * depend on a checksum fetched over the same (attacker-controllable) channel as the artifact.
 *
 * MUST be filled from the official https://nodejs.org/dist/v<PINNED>/SHASUMS256.txt — verified by a
 * human, never transcribed by a model — before a real `make pack`. Until then a real pack
 * hard-fails via assertPinnedSha256() (fail-safe, never fail-open). Unit tests inject a fixture
 * hash via `expectedSha256` and do not depend on these values.
 */
export const PINNED_NODE_SHA256: Record<DarwinArch, string> = {
  arm64: "REPLACE_WITH_REAL_SHA256_FROM_SHASUMS256_TXT_darwin_arm64",
  x64:   "REPLACE_WITH_REAL_SHA256_FROM_SHASUMS256_TXT_darwin_x64",
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Minimal shape of a fetch Response this module needs (global `fetch` satisfies it). */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface FetchNodeBinaryOpts {
  version: string;
  arch: DarwinArch;
  /** Cache root (e.g. ~/.scvn/cache/node). */
  cacheDir: string;
  /** Expected hex SHA-256 of the tarball. Defaults to the pinned source constant. */
  expectedSha256?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: FetchLike;
}

/** Map process.arch → darwin tarball arch; throws on unsupported. */
export function currentDarwinArch(): DarwinArch {
  switch (process.arch) {
    case "arm64": return "arm64";
    case "x64":   return "x64";
    default:
      throw new Error(
        `make pack bundles Node for macOS arm64/x64 only — unsupported arch: ${process.arch}`,
      );
  }
}

export function tarballName(version: string, arch: DarwinArch): string {
  return `node-v${version}-darwin-${arch}.tar.gz`;
}

export function tarballUrl(version: string, arch: DarwinArch): string {
  return `https://nodejs.org/dist/v${version}/${tarballName(version, arch)}`;
}

/** Hex SHA-256 of a buffer. */
export function sha256(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

function assertPinnedSha256(arch: DarwinArch, expected: string): void {
  if (!SHA256_HEX.test(expected)) {
    throw new Error(
      `PINNED_NODE_SHA256.${arch} is not a 64-hex SHA-256 — fill it from ` +
      `https://nodejs.org/dist/v${PINNED_NODE_VERSION}/SHASUMS256.txt before packing with Node ` +
      `(or run "make pack-no-node" to ship without a bundled runtime).`,
    );
  }
}

/** Final cache path for a (version, arch): `<cacheDir>/node-v<v>-darwin-<arch>/bin/node`. */
function cacheBinPath(cacheDir: string, version: string, arch: DarwinArch): string {
  return path.join(cacheDir, `node-v${version}-darwin-${arch}`, "bin", "node");
}

async function fileSha256(file: string): Promise<string> {
  return sha256(await readFile(file));
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a verified, cached Node binary for (version, arch) — downloading, verifying, and
 * extracting if needed. Returns the absolute path to `bin/node`. Throws on checksum mismatch (no
 * partial file is left at the canonical path), a non-OK download, or an unsupported arch.
 */
export async function fetchNodeBinary(opts: FetchNodeBinaryOpts): Promise<string> {
  const { version, arch, cacheDir } = opts;
  const expected = opts.expectedSha256 ?? PINNED_NODE_SHA256[arch];
  assertPinnedSha256(arch, expected);
  const doFetch: FetchLike = opts.fetchImpl ?? ((url: string) => fetch(url));

  const finalBin = cacheBinPath(cacheDir, version, arch);
  // `<cacheDir>/node-v<v>-darwin-<arch>` — the versioned dir we publish atomically.
  const finalDir = path.dirname(path.dirname(finalBin));
  // Records the EXTRACTED binary's own hash (≠ the tarball hash) so a cache hit can detect
  // post-publish corruption/tampering. Written + renamed atomically with the binary.
  const sidecar = path.join(finalDir, ".node-sha256");

  // Cache hit: re-verify the cached binary against its sidecar; drop + refetch on any mismatch or
  // missing sidecar (no poison-once / truncated-extract foothold survives).
  if (await isFile(finalBin)) {
    const recorded = await readFile(sidecar, "utf8").catch(() => null);
    if (recorded !== null && recorded.trim() === (await fileSha256(finalBin))) return finalBin;
    await rm(finalDir, { recursive: true, force: true });
  }

  // Download + verify the tarball buffer BEFORE touching the filesystem.
  const res = await doFetch(tarballUrl(version, arch));
  if (!res.ok) {
    throw new Error(`Node download failed: HTTP ${res.status} for ${tarballUrl(version, arch)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expected) {
    throw new Error(
      `Node tarball SHA-256 mismatch for ${tarballName(version, arch)} (expected ${expected}, got ${got})`,
    );
  }

  await mkdir(cacheDir, { recursive: true, mode: 0o700 });

  // Work entirely inside a unique staging dir (mkdtemp), then atomic-rename onto the final path. A
  // kill leaves only an orphan staging dir, never a half-written cache entry; the unique dir also
  // means concurrent same-arch fetches never collide (last rename wins).
  const staging = await mkdtemp(path.join(cacheDir, ".stage-"));
  try {
    const tmpTarball = path.join(staging, "dl.tar.gz");
    await writeFile(tmpTarball, buf);
    // bsdtar: extract just the single bin/node member, stripping the `node-v.../` top component.
    const member = `node-v${version}-darwin-${arch}/bin/node`;
    await execa("tar", ["-xzf", tmpTarball, "-C", staging, "--strip-components=1", member]);
    const stagedBin = path.join(staging, "bin", "node");
    if (!(await isFile(stagedBin))) {
      throw new Error(`tar did not yield bin/node from ${tarballName(version, arch)}`);
    }
    await chmod(stagedBin, 0o755);
    // Record the extracted binary's hash so binary + sidecar publish together.
    await writeFile(path.join(staging, ".node-sha256"), await fileSha256(stagedBin), "utf8");
    await rm(tmpTarball, { force: true }); // never publish the tarball into the cache
    await rm(finalDir, { recursive: true, force: true });
    await rename(staging, finalDir);
    return finalBin;
  } catch (err) {
    await rm(staging, { recursive: true, force: true });
    throw err;
  }
}
