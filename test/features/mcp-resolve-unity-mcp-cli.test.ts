/**
 * test/features/mcp-resolve-unity-mcp-cli.test.ts — The offline CLI closure.
 *
 * The gate here is not "did we copy some files" but "does the cached CLI actually
 * RUN with no network". So the fake packages genuinely `import` one another —
 * including a transitive hop (yocto-spinner → yoctocolors) — and the smoke test
 * executes the real thing through `process.execPath`. A missing dependency shows
 * up the way it would on the artist's Mac: ERR_MODULE_NOT_FOUND.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { fakeRegistry } from "../helpers/mcp-registry-fake.js";
import type { FakePackage } from "../helpers/mcp-registry-fake.js";
import { _resetPackumentCache } from "../../src/services/npm-registry.js";
import {
  ensureUnityMcpCli,
  resolveCliVersion,
} from "../../src/features/mcp/resolve-unity-mcp-cli.js";
import { cliEntryPath } from "../../src/features/mcp/resolve-mcp-cache.js";
import {
  _setBundledMcpRootForTest,
  _resetBundledMcpCache,
} from "../../src/features/mcp/bundled-mcp-paths.js";

const CORE_VER = "0.82.4";

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
}

/**
 * The real closure shape, verified live: unity-mcp-cli → chalk, commander,
 * yocto-spinner → yoctocolors. Every module is genuine ESM that imports its deps,
 * so Node's resolver is what proves the closure, not an assertion about filenames.
 */
function cliCatalog(cliVersion = CORE_VER): FakePackage[] {
  return [
    {
      name: "unity-mcp-cli",
      version: cliVersion,
      dependencies: { chalk: "^5.6.2", commander: "^13.1.0", "yocto-spinner": "^1.1.0" },
      build: (dir) =>
        writeFiles(dir, {
          "package.json": JSON.stringify({
            name: "unity-mcp-cli",
            version: cliVersion,
            type: "module",
            bin: { "unity-mcp-cli": "bin/unity-mcp-cli.js" },
          }),
          "bin/unity-mcp-cli.js": [
            'import chalk from "chalk";',
            'import { program } from "commander";',
            'import spinner from "yocto-spinner";',
            "",
            "// Touch every import so an unused-but-missing dep cannot pass.",
            "const ok = [chalk.green(\"x\"), program.name, spinner()].join(\"\");",
            'if (process.argv.includes("--version")) {',
            `  console.log("${cliVersion}");`,
            "  process.exit(0);",
            "}",
            'if (process.argv[2] === "setup-mcp") {',
            "  console.log(`setup-mcp ${process.argv[3]} ${process.argv[4]} ${ok.length}`);",
            "  process.exit(0);",
            "}",
            "process.exit(2);",
          ].join("\n"),
        }),
    },
    {
      name: "chalk",
      version: "5.6.2",
      build: (dir) =>
        writeFiles(dir, {
          "package.json": JSON.stringify({ name: "chalk", version: "5.6.2", type: "module", main: "index.js" }),
          "index.js": "export default { green: (s) => s };\n",
        }),
    },
    {
      name: "commander",
      version: "13.1.0",
      build: (dir) =>
        writeFiles(dir, {
          "package.json": JSON.stringify({ name: "commander", version: "13.1.0", type: "module", main: "index.js" }),
          "index.js": 'export const program = { name: "unity-mcp-cli" };\n',
        }),
    },
    {
      name: "yocto-spinner",
      version: "1.1.0",
      dependencies: { yoctocolors: "^2.1.1" },
      build: (dir) =>
        writeFiles(dir, {
          "package.json": JSON.stringify({
            name: "yocto-spinner",
            version: "1.1.0",
            type: "module",
            main: "index.js",
          }),
          // The transitive hop: this import is what a shallow closure would break on.
          "index.js": 'import colors from "yoctocolors";\nexport default () => colors.dim("~");\n',
        }),
    },
    {
      name: "yoctocolors",
      version: "2.1.1",
      build: (dir) =>
        writeFiles(dir, {
          "package.json": JSON.stringify({ name: "yoctocolors", version: "2.1.1", type: "module", main: "index.js" }),
          "index.js": "export default { dim: (s) => s };\n",
        }),
    },
  ];
}

beforeEach(() => {
  _resetPackumentCache();
  _resetBundledMcpCache();
  _setBundledMcpRootForTest(null);
});

describe("ensureUnityMcpCli", () => {
  it("caches the CLI with a closure it can actually RUN offline", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog());

    const result = await ensureUnityMcpCli(CORE_VER, { cacheDir, ...registry });

    expect(result.version).toBe(CORE_VER);
    for (const dep of ["chalk", "commander", "yocto-spinner", "yoctocolors"]) {
      await expect(access(path.join(result.dir, "node_modules", dep))).resolves.toBeUndefined();
    }

    // THE gate: run it through the same Node scvn will use, with no network.
    // A missing transitive dep fails here with ERR_MODULE_NOT_FOUND.
    const run = await execa(process.execPath, [cliEntryPath(result.dir), "--version"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim()).toBe(CORE_VER);
  });

  it("invokes setup-mcp the way install will", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog());
    const { dir } = await ensureUnityMcpCli(CORE_VER, { cacheDir, ...registry });

    const run = await execa(process.execPath, [
      cliEntryPath(dir),
      "setup-mcp",
      "claude-code",
      "/proj",
    ]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("setup-mcp claude-code /proj");
  });

  it("is a fast path once cached — zero network", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog());
    await ensureUnityMcpCli(CORE_VER, { cacheDir, ...registry });
    registry.fetchImpl.mockClear();
    registry.fetchBinary.mockClear();

    const again = await ensureUnityMcpCli(CORE_VER, { cacheDir, ...registry });

    expect(again.alreadyStaged).toBe(true);
    expect(registry.fetchImpl).not.toHaveBeenCalled();
    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });

  it("does not use an older cached CLI in exact mode", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry([...cliCatalog("0.82.3"), ...cliCatalog(CORE_VER)]);
    await ensureUnityMcpCli("0.82.3", { cacheDir, ...registry });

    const result = await ensureUnityMcpCli(CORE_VER, { cacheDir, exact: true, ...registry });

    expect(result.version).toBe(CORE_VER);
    expect(result.alreadyStaged).toBe(false);
  });
  it("uses an older cached CLI only when the registry is unavailable", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog("0.82.3"));
    await ensureUnityMcpCli("0.82.3", { cacheDir, ...registry });
    _resetPackumentCache();
    const offline = {
      fetchImpl: vi.fn(async () => { throw new Error("network is down"); }),
      fetchBinary: vi.fn(async () => { throw new Error("network is down"); }),
    };

    const result = await ensureUnityMcpCli(CORE_VER, { cacheDir, exact: true, ...offline });

    expect(result.version).toBe("0.82.3");
    expect(result.alreadyStaged).toBe(true);
  });

  it("does not hide a published exact-version mismatch behind the cache", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog("0.82.3"));
    await ensureUnityMcpCli("0.82.3", { cacheDir, ...registry });

    await expect(ensureUnityMcpCli(CORE_VER, { cacheDir, exact: true, ...registry })).rejects.toThrow(/registry has no exact version/);
  });
  it("resolves a BUNDLED cli with NO registry call at all (the artist-Mac path)", async () => {
    // Looking up the version before checking the cache would need the network to
    // find something already sitting on disk — which is precisely what a bundled,
    // offline machine cannot do. The cache probe has to come first.
    const bundleRoot = await tmpDir("scvn-bundle-");
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const seed = await fakeRegistry(cliCatalog("0.82.3"));
    await ensureUnityMcpCli("0.82.3", { cacheDir: bundleRoot, ...seed });
    _setBundledMcpRootForTest(bundleRoot);

    _resetPackumentCache();
    const offline = {
      fetchImpl: vi.fn(async () => { throw new Error("network is down"); }),
      fetchBinary: vi.fn(async () => { throw new Error("network is down"); }),
    };

    const result = await ensureUnityMcpCli(CORE_VER, { cacheDir, exact: true, ...offline });

    expect(result.version).toBe("0.82.3");
    expect(result.alreadyStaged).toBe(true);
    expect(offline.fetchImpl).toHaveBeenCalled();
    // And the bundled copy still runs.
    const run = await execa(process.execPath, [cliEntryPath(result.dir), "--version"]);
    expect(run.exitCode).toBe(0);
  });

  it("refuses a tampered dependency tarball", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog());
    registry.tamper("yoctocolors");

    await expect(ensureUnityMcpCli(CORE_VER, { cacheDir, ...registry })).rejects.toThrow(
      /integrity MISMATCH/i,
    );
    await expect(access(path.join(cacheDir, `unity-mcp-cli-${CORE_VER}`))).rejects.toThrow();
  });

  it("dry-run fetches nothing", async () => {
    const cacheDir = await tmpDir("scvn-cli-cache-");
    const registry = await fakeRegistry(cliCatalog());

    await ensureUnityMcpCli(CORE_VER, { cacheDir, dryRun: true, ...registry });

    expect(registry.fetchBinary).not.toHaveBeenCalled();
  });
});

describe("resolveCliVersion", () => {
  it("prefers the exact core version", async () => {
    const registry = await fakeRegistry(cliCatalog());

    expect(await resolveCliVersion(CORE_VER, { cacheDir: "/x", ...registry })).toBe(CORE_VER);
  });

  it("falls back to the newest CLI NOT EXCEEDING core, and says so", async () => {
    // Publish lag: core is 0.83.0 but the CLI tops out at 0.82.4.
    const registry = await fakeRegistry(cliCatalog("0.82.4"));
    const warns: string[] = [];
    const reporter = {
      onStatus: () => {},
      onLog: (e: { level: string; message: string }) => {
        if (e.level === "warn") warns.push(e.message);
      },
    };

    const picked = await resolveCliVersion("0.83.0", { cacheDir: "/x", reporter, ...registry });

    expect(picked).toBe("0.82.4");
    expect(warns.join("\n")).toMatch(/not exceeding core/);
  });

  it("never pairs an old core with a NEWER client", async () => {
    const registry = await fakeRegistry(cliCatalog("0.90.0"));

    await expect(
      resolveCliVersion("0.82.4", { cacheDir: "/x", ...registry }),
    ).rejects.toThrow(/at or below core/);
  });
});
