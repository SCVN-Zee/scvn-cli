/**
 * test/features/mcp-versions-json.test.ts — The version-dir ledger + tarball extraction.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  readVersionsJson,
  writeVersionsJson,
  hasVersionsJson,
  centralPkgs,
} from "../../src/features/mcp/versions-json.js";
import { extractTarball } from "../../src/features/mcp/extract-tarball.js";

describe("versions.json round-trip", () => {
  it("preserves pins across write → read", async () => {
    const dir = await tmpDir("scvn-vj-");

    await writeVersionsJson(dir, {
      core: "0.82.4",
      packages: { "com.ivanmurzak.unity.mcp": "0.82.4", "com.x.animation": "1.2.24" },
      pins: { "com.x.animation": false },
      fetchedAt: "2026-07-13T00:00:00Z",
    });
    const doc = await readVersionsJson(dir);

    expect(doc.core).toBe("0.82.4");
    expect(doc.pins?.["com.x.animation"]).toBe(false);
  });

  it("distinguishes an absent pins key from an empty one — grandfathering depends on it", async () => {
    const dir = await tmpDir("scvn-vj-");
    await writeFile(
      path.join(dir, "versions.json"),
      JSON.stringify({ core: "1.0.0", packages: { a: "1" }, fetchedAt: "x" }),
      "utf8",
    );

    expect((await readVersionsJson(dir)).pins).toBeUndefined();
  });

  it("throws when the version is not staged", async () => {
    const dir = await tmpDir("scvn-vj-");
    await expect(readVersionsJson(dir)).rejects.toThrow(/not staged/);
    expect(await hasVersionsJson(dir)).toBe(false);
  });

  it("throws on corrupt JSON rather than silently staging nothing", async () => {
    const dir = await tmpDir("scvn-vj-");
    await writeFile(path.join(dir, "versions.json"), "{ not json", "utf8");

    await expect(readVersionsJson(dir)).rejects.toThrow(/valid JSON/);
  });
});

describe("centralPkgs", () => {
  it("returns the staged package names, sorted", async () => {
    const dir = await tmpDir("scvn-vj-");
    await writeVersionsJson(dir, {
      core: "1.0.0",
      packages: { "pkg.b": "1", "pkg.a": "2" },
      fetchedAt: "x",
    });

    expect(await centralPkgs(dir)).toEqual(["pkg.a", "pkg.b"]);
  });
});

describe("extractTarball", () => {
  it("strips the tarball's package/ root", async () => {
    const root = await tmpDir("scvn-tgz-");
    const src = path.join(root, "package");
    await mkdir(path.join(src, "Editor"), { recursive: true });
    await writeFile(path.join(src, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    await writeFile(path.join(src, "Editor", "E.cs"), "e\n");
    const tgz = path.join(root, "pkg.tgz");
    await execa("tar", ["-czf", tgz, "-C", root, "package"]);

    const out = path.join(root, "out");
    await extractTarball(tgz, out);

    expect(await readFile(path.join(out, "package.json"), "utf8")).toContain('"name":"x"');
    await expect(access(path.join(out, "Editor", "E.cs"))).resolves.toBeUndefined();
    await expect(access(path.join(out, "package"))).rejects.toThrow();
  });

  it("extracts into a destination path containing a space", async () => {
    // The cache dirname is `Unity-MCP V<ver>` — every consumer must survive it.
    const root = await tmpDir("scvn-tgz-");
    const src = path.join(root, "package");
    await mkdir(src, { recursive: true });
    await writeFile(path.join(src, "package.json"), "{}\n");
    const tgz = path.join(root, "pkg.tgz");
    await execa("tar", ["-czf", tgz, "-C", root, "package"]);

    const out = path.join(root, "Unity-MCP V1.0.0", "com.x.pkg");
    await extractTarball(tgz, out);

    await expect(access(path.join(out, "package.json"))).resolves.toBeUndefined();
  });
});
