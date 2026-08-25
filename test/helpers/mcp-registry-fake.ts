/**
 * test/helpers/mcp-registry-fake.ts — An in-memory OpenUPM/npm serving real tarballs.
 *
 * The tarballs are genuinely built with `tar` and genuinely integrity-hashed, so
 * the fetch → verify → extract → transform pipeline is exercised end to end
 * without touching the network. `fetchBinary.mock.calls` is what the offline
 * assertions read: a rollback that quietly re-downloads would show up here.
 */

import path from "node:path";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { vi } from "vitest";
import { createHash } from "node:crypto";
import type { Packument } from "../../src/services/npm-registry.js";

export interface FakePackage {
  name: string;
  version: string;
  /** Populate the package tree (called with the dir that becomes the tarball's `package/`). */
  build: (dir: string) => Promise<void>;
  /** Exact core version this addon pins, if any. */
  pinsCore?: string;
  /** Extra declared dependencies (e.g. core → ppx). */
  dependencies?: Record<string, string>;
}

/** Build a real npm-shaped tarball (contents under `package/`) and return its bytes. */
export async function buildTarball(build: (dir: string) => Promise<void>): Promise<Buffer> {
  const root = await mkdtemp(path.join(tmpdir(), "scvn-tgz-"));
  try {
    const pkgDir = path.join(root, "package");
    await mkdir(pkgDir, { recursive: true });
    await build(pkgDir);
    const tgz = path.join(root, "out.tgz");
    await execa("tar", ["-czf", tgz, "-C", root, "package"]);
    return await readFile(tgz);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export interface FakeRegistry {
  /** Injectable packument fetch. */
  fetchImpl: ReturnType<typeof vi.fn>;
  /** Injectable tarball fetch — assert `.mock.calls.length === 0` to prove offline. */
  fetchBinary: ReturnType<typeof vi.fn>;
  /** Corrupt a package's bytes AFTER its integrity was published (tamper simulation). */
  tamper: (name: string) => void;
}

/**
 * A registry serving `packages`, with `latest` as every package's dist-tag.
 * Tarball bytes are built once, up front, and hashed into dist.integrity.
 */
export async function fakeRegistry(packages: FakePackage[]): Promise<FakeRegistry> {
  const tarballs = new Map<string, Buffer>();
  const packuments = new Map<string, Packument>();

  for (const pkg of packages) {
    const bytes = await buildTarball(pkg.build);
    const url = `https://registry.test/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`;
    tarballs.set(url, bytes);

    const dependencies: Record<string, string> = { ...pkg.dependencies };
    if (pkg.pinsCore) dependencies["com.ivanmurzak.unity.mcp"] = pkg.pinsCore;

    const existing = packuments.get(pkg.name) ?? { "dist-tags": {}, versions: {} };
    existing["dist-tags"] = { latest: pkg.version };
    existing.versions = {
      ...existing.versions,
      [pkg.version]: {
        dist: {
          integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
          tarball: url,
        },
        dependencies,
      },
    };
    packuments.set(pkg.name, existing);
  }

  const fetchImpl = vi.fn(async (url: string) => {
    const name = decodeURIComponent(url.split("/").pop() ?? "");
    const packument = packuments.get(name);
    if (!packument) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => packument };
  });

  const fetchBinary = vi.fn(async (url: string) => {
    const bytes = tarballs.get(url);
    if (!bytes) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  });

  const tamper = (name: string): void => {
    for (const [url, bytes] of tarballs) {
      if (url.includes(`/${name}/`)) {
        const corrupted = Buffer.from(bytes);
        corrupted[corrupted.length - 1] ^= 0xff; // flip a byte; integrity now lies
        tarballs.set(url, corrupted);
      }
    }
  };

  return { fetchImpl, fetchBinary, tamper };
}
