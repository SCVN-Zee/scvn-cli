/**
 * test/features/mcp-transforms.test.ts — The three deterministic source transforms.
 *
 * These rewrite upstream C# so the package works as vendored Assets/ source
 * instead of a UPM package. They run once at fetch, into the cache — never
 * against a project tree.
 *
 * The asymmetry is deliberate and load-bearing:
 *   relocation → THROWS on drift (a silently wrong AssetsPathPrefix means the
 *                plugin loads nothing, with no compile error to catch it)
 *   webgl      → WARNS on drift (a missed shim only risks a Luna/WebGL export)
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { readFile, writeFile, mkdir, access, cp } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  makeCoreFixture,
  makeAddonFixture,
  EDITOR_ASSET_LOADER_REL,
  RECOMPILE_GATE_REL,
} from "../helpers/mcp-fixtures.js";
import { applyRelocationShim } from "../../src/features/mcp/transforms/relocation-shim.js";
import { applyWebglShim } from "../../src/features/mcp/transforms/webgl-shim.js";
import { pruneTests } from "../../src/features/mcp/transforms/prune-tests.js";
import { applyTransforms } from "../../src/features/mcp/apply-transforms.js";
import { CORE_PKG } from "../../src/features/mcp/mcp-constants.js";

function collectWarns() {
  const warns: string[] = [];
  return {
    reporter: {
      onStatus: () => {},
      onLog: (entry: { level: string; message: string }) => {
        if (entry.level === "warn") warns.push(entry.message);
      },
    },
    warns,
  };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function loaderText(pkgDir: string): Promise<string> {
  return readFile(path.join(pkgDir, EDITOR_ASSET_LOADER_REL), "utf8");
}

async function gateText(pkgDir: string): Promise<string> {
  return readFile(path.join(pkgDir, RECOMPILE_GATE_REL), "utf8");
}

describe("applyRelocationShim", () => {
  it("repoints AssetsPathPrefix at the vendored location, sparing PackagePathPrefix", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyRelocationShim(pkg);
    const text = await loaderText(pkg);

    expect(text).toContain(
      'private const string AssetsPathPrefix = "Assets/UnityMCP/com.ivanmurzak.unity.mcp/";',
    );
    // PackagePathPrefix keeps pointing at the UPM location — only ONE const moves.
    expect(text).toContain(
      'private const string PackagePathPrefix = "Packages/com.ivanmurzak.unity.mcp/";',
    );
  });

  it("uncomments the Assets fallback and restores the comma the comment ate", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyRelocationShim(pkg);
    const text = await loaderText(pkg);

    expect(text).toContain("                AssetsPathPrefix + relativePath");
    expect(text).not.toContain("//AssetsPathPrefix");
    expect(text).toContain("PackagePathPrefix + relativePath,");
    expect(text).not.toContain("relativePath//,");
  });

  it("is idempotent — a second pass is byte-identical", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyRelocationShim(pkg);
    const once = await loaderText(pkg);
    await applyRelocationShim(pkg);

    expect(await loaderText(pkg)).toBe(once);
  });

  it("throws on genuine upstream drift instead of writing a half-shimmed file", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await mkdir(path.join(pkg, path.dirname(EDITOR_ASSET_LOADER_REL)), { recursive: true });
    const drifted = "public static class EditorAssetLoader { }\n";
    await writeFile(path.join(pkg, EDITOR_ASSET_LOADER_REL), drifted, "utf8");

    await expect(applyRelocationShim(pkg)).rejects.toThrow(/DRIFT/);
    expect(await loaderText(pkg)).toBe(drifted); // untouched
  });

  it("throws when EditorAssetLoader.cs is missing entirely", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await mkdir(pkg, { recursive: true });

    await expect(applyRelocationShim(pkg)).rejects.toThrow(/EditorAssetLoader\.cs/);
  });

  it("does not report 'already applied' when only the commented form is present", async () => {
    // The trap the bash `swap()` was written around: the uncommented target
    // `AssetsPathPrefix + relativePath` is a SUBSTRING of the commented
    // `//AssetsPathPrefix + relativePath`. Probing the new form first would see
    // a match, skip the swap, and leave the fallback commented out — the plugin
    // would then resolve zero editor assets, with nothing failing to compile.
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyRelocationShim(pkg);

    expect(await loaderText(pkg)).not.toContain("//AssetsPathPrefix");
  });
});

describe("applyWebglShim", () => {
  it("injects the WebGL skip after the Unknown guard", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyWebglShim(pkg);
    const text = await gateText(pkg);

    expect(text).toContain("if (group == BuildTargetGroup.WebGL)");
    // The original guard survives, and the new one follows it.
    const unknownAt = text.indexOf("BuildTargetGroup.Unknown");
    const webglAt = text.indexOf("BuildTargetGroup.WebGL");
    expect(unknownAt).toBeGreaterThan(-1);
    expect(webglAt).toBeGreaterThan(unknownAt);
  });

  it("is idempotent — a second pass is byte-identical", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await applyWebglShim(pkg);
    const once = await gateText(pkg);
    await applyWebglShim(pkg);

    expect(await gateText(pkg)).toBe(once);
  });

  it("warns and leaves the file alone when the anchor is gone (never throws)", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);
    const anchorless = "static void ForEachTarget() { /* no Unknown guard */ }\n";
    await writeFile(path.join(pkg, RECOMPILE_GATE_REL), anchorless, "utf8");
    const { reporter, warns } = collectWarns();

    await expect(applyWebglShim(pkg, { reporter })).resolves.toBeUndefined();

    expect(await gateText(pkg)).toBe(anchorless);
    expect(warns.join("\n")).toMatch(/WebGL/);
  });

  it("warns and continues when RecompileGate.cs is missing", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await mkdir(pkg, { recursive: true });
    const { reporter, warns } = collectWarns();

    await expect(applyWebglShim(pkg, { reporter })).resolves.toBeUndefined();

    expect(warns.join("\n")).toMatch(/RecompileGate\.cs/);
  });

  it("tolerates whitespace variation around the anchor", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);
    await writeFile(
      path.join(pkg, RECOMPILE_GATE_REL),
      "foreach (x) {\n    if (group == BuildTargetGroup.Unknown)\n            continue;\n    more();\n}\n",
      "utf8",
    );

    await applyWebglShim(pkg);

    expect(await gateText(pkg)).toContain("BuildTargetGroup.WebGL");
  });
});

describe("pruneTests", () => {
  it("removes Tests/ and TestFiles/ with their .meta, keeping everything else", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await makeCoreFixture(pkg);

    await pruneTests(pkg);

    expect(await exists(path.join(pkg, "Tests"))).toBe(false);
    expect(await exists(path.join(pkg, "Tests.meta"))).toBe(false);
    expect(await exists(path.join(pkg, "TestFiles"))).toBe(false);
    expect(await exists(path.join(pkg, "TestFiles.meta"))).toBe(false);
    expect(await exists(path.join(pkg, "Runtime/Keep.cs"))).toBe(true);
  });

  it("is a no-op when there is nothing to prune", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await mkdir(pkg, { recursive: true });

    await expect(pruneTests(pkg)).resolves.toBeUndefined();
  });
});

describe("applyTransforms", () => {
  it("shims + prunes a core package, and the whole pipeline is idempotent", async () => {
    const root = await tmpDir("scvn-mcp-");
    const pkg = path.join(root, "core");
    await makeCoreFixture(pkg);

    await applyTransforms(pkg, CORE_PKG);
    const snapshot = path.join(root, "after-once");
    await cp(pkg, snapshot, { recursive: true });
    await applyTransforms(pkg, CORE_PKG);

    // diff -rq: a byte-level tree comparison, the bash T1 assertion.
    await expect(execa("diff", ["-rq", snapshot, pkg])).resolves.toMatchObject({ exitCode: 0 });
    expect(await loaderText(pkg)).toContain("Assets/UnityMCP/com.ivanmurzak.unity.mcp/");
    expect(await gateText(pkg)).toContain("BuildTargetGroup.WebGL");
  });

  it("only prunes a non-core package — the shims are core-only", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "addon");
    await makeAddonFixture(pkg);

    await applyTransforms(pkg, "com.ivanmurzak.unity.mcp.animation");

    expect(await exists(path.join(pkg, "Tests"))).toBe(false);
    expect(await exists(path.join(pkg, "Editor/Addon.cs"))).toBe(true);
  });

  it("propagates a core drift throw — a broken core is never staged", async () => {
    const pkg = path.join(await tmpDir("scvn-mcp-"), "core");
    await mkdir(path.join(pkg, path.dirname(EDITOR_ASSET_LOADER_REL)), { recursive: true });
    await writeFile(path.join(pkg, EDITOR_ASSET_LOADER_REL), "class X { }\n", "utf8");

    await expect(applyTransforms(pkg, CORE_PKG)).rejects.toThrow(/DRIFT/);
  });
});
