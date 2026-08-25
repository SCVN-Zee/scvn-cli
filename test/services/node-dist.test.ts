/**
 * test/services/node-dist.test.ts — Offline tests for the Node download/verify/cache service.
 *
 * No network: `fetchImpl` is injected with bytes from a tiny REAL `.tar.gz` fixture (built with
 * the same `node-v<ver>-darwin-<arch>/bin/node` layout the dist tarballs use), and the expected
 * SHA-256 is the fixture's real hash (so the pinned-in-source constants aren't needed here).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import path from "node:path";
import { mkdir, writeFile, readFile, chmod, stat } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  PINNED_NODE_VERSION,
  currentDarwinArch,
  tarballName,
  tarballUrl,
  sha256,
  fetchNodeBinary,
  type DarwinArch,
} from "../../src/services/node-dist.js";

const V = PINNED_NODE_VERSION;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("node-dist url/name helpers", () => {
  it("tarballName + tarballUrl are exact for arm64", () => {
    expect(tarballName(V, "arm64")).toBe(`node-v${V}-darwin-arm64.tar.gz`);
    expect(tarballUrl(V, "arm64")).toBe(`https://nodejs.org/dist/v${V}/node-v${V}-darwin-arm64.tar.gz`);
  });
  it("tarballName + tarballUrl are exact for x64", () => {
    expect(tarballName(V, "x64")).toBe(`node-v${V}-darwin-x64.tar.gz`);
    expect(tarballUrl(V, "x64")).toBe(`https://nodejs.org/dist/v${V}/node-v${V}-darwin-x64.tar.gz`);
  });
});

describe("currentDarwinArch", () => {
  const orig = process.arch;
  afterEach(() => Object.defineProperty(process, "arch", { value: orig, configurable: true }));

  it("maps arm64/x64 and throws on anything else", () => {
    Object.defineProperty(process, "arch", { value: "arm64", configurable: true });
    expect(currentDarwinArch()).toBe("arm64");
    Object.defineProperty(process, "arch", { value: "x64", configurable: true });
    expect(currentDarwinArch()).toBe("x64");
    Object.defineProperty(process, "arch", { value: "ia32", configurable: true });
    expect(() => currentDarwinArch()).toThrow(/unsupported arch/);
  });
});

// ---------------------------------------------------------------------------
// fetchNodeBinary — fixture-backed, offline
// ---------------------------------------------------------------------------

/** Build a real `.tar.gz` mirroring the dist layout; return its bytes + sha256. */
async function buildFixtureTarball(
  arch: DarwinArch,
  content = "#!/bin/sh\necho FAKE_NODE\n",
): Promise<{ bytes: Buffer; sha: string }> {
  const work = await tmpDir("scvn-fixture-");
  const top = `node-v${V}-darwin-${arch}`;
  await mkdir(path.join(work, top, "bin"), { recursive: true });
  await writeFile(path.join(work, top, "bin", "node"), content);
  await chmod(path.join(work, top, "bin", "node"), 0o755);
  const tgz = path.join(work, "fixture.tar.gz");
  await execa("tar", ["-czf", tgz, "-C", work, top]);
  const bytes = await readFile(tgz);
  return { bytes, sha: sha256(bytes) };
}

/** A vi.fn() fetchImpl returning the given bytes (as a fresh ArrayBuffer). */
function fetchReturning(bytes: Buffer, ok = true, status = 200) {
  return vi.fn(async (_url: string) => ({
    ok,
    status,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  }));
}

function finalBinPath(cacheDir: string, arch: DarwinArch): string {
  return path.join(cacheDir, `node-v${V}-darwin-${arch}`, "bin", "node");
}

describe("fetchNodeBinary", () => {
  it("happy path: downloads, verifies, extracts an executable bin/node", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const { bytes, sha } = await buildFixtureTarball("arm64");
    const fetchImpl = fetchReturning(bytes);

    const bin = await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });

    expect(bin).toBe(finalBinPath(cacheDir, "arm64"));
    const st = await stat(bin);
    expect(st.isFile()).toBe(true);
    expect((st.mode & 0o111) !== 0).toBe(true); // executable bit set
    expect(await readFile(bin, "utf8")).toContain("FAKE_NODE");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("checksum mismatch → throws, no file left at the final path", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const { bytes } = await buildFixtureTarball("arm64");
    const fetchImpl = fetchReturning(bytes);

    await expect(
      fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: "0".repeat(64), fetchImpl }),
    ).rejects.toThrow(/SHA-256 mismatch/);
    await expect(stat(finalBinPath(cacheDir, "arm64"))).rejects.toThrow();
  });

  it("valid cache hit → no second fetch", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const { bytes, sha } = await buildFixtureTarball("arm64");
    const fetchImpl = fetchReturning(bytes);

    await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });
    await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("corrupted cache hit → re-verify fails → refetch restores the binary", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const { bytes, sha } = await buildFixtureTarball("arm64");
    const fetchImpl = fetchReturning(bytes);

    const bin = await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });
    await writeFile(bin, "garbage"); // poison the cached binary
    const bin2 = await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });

    expect(bin2).toBe(bin);
    expect(await readFile(bin2, "utf8")).toContain("FAKE_NODE");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("pre-seeded wrong-hash file at the final path is not a valid hit", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const { bytes, sha } = await buildFixtureTarball("arm64");
    const final = finalBinPath(cacheDir, "arm64");
    await mkdir(path.dirname(final), { recursive: true });
    await writeFile(final, ""); // 0-byte, wrong hash
    const fetchImpl = fetchReturning(bytes);

    const bin = await fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: sha, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await readFile(bin, "utf8")).toContain("FAKE_NODE");
  });

  it("non-OK download → throws", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const fetchImpl = fetchReturning(Buffer.from(""), false, 404);
    await expect(
      fetchNodeBinary({ version: V, arch: "arm64", cacheDir, expectedSha256: "a".repeat(64), fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("unfilled pinned hash (no override) → hard-fails fail-safe, no fetch", async () => {
    const cacheDir = await tmpDir("scvn-cache-");
    const fetchImpl = fetchReturning(Buffer.from(""));
    await expect(
      fetchNodeBinary({ version: V, arch: "arm64", cacheDir, fetchImpl }),
    ).rejects.toThrow(/64-hex SHA-256/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
