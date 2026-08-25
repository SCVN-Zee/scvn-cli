/**
 * test/features/mcp-cache-paths.test.ts — Cache layout, including the deliberate space.
 *
 * The version dirname carries a space (`Unity-MCP V0.82.4`) for parity with the
 * bash original's central staging folder, so every path consumer has to survive
 * one. Centralizing the name here is what makes that safe.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  userMcpCacheDir,
  verDirName,
  verDir,
  cliDirName,
  cliDir,
  parseVerDirName,
  listVerDirs,
} from "../../src/features/mcp/mcp-cache-paths.js";

describe("cache path helpers", () => {
  it("keeps the space in the version dirname", () => {
    expect(verDirName("0.82.4")).toBe("Unity-MCP V0.82.4");
    expect(verDir("0.82.4", "/cache")).toBe(path.join("/cache", "Unity-MCP V0.82.4"));
  });

  it("names the cli dir by version", () => {
    expect(cliDirName("0.82.4")).toBe("unity-mcp-cli-0.82.4");
    expect(cliDir("0.82.4", "/cache")).toBe(path.join("/cache", "unity-mcp-cli-0.82.4"));
  });

  it("defaults the user cache under the scvn home", () => {
    expect(userMcpCacheDir("/home/.scvn")).toBe(path.join("/home/.scvn", "mcp"));
  });

  it("parses a version back out of a dirname", () => {
    expect(parseVerDirName("Unity-MCP V0.82.4")).toBe("0.82.4");
    expect(parseVerDirName("unity-mcp-cli-0.82.4")).toBeNull();
    expect(parseVerDirName("random")).toBeNull();
  });

  it("rejects a bare `Unity-MCP V` — an empty version poisons every path downstream", () => {
    expect(parseVerDirName("Unity-MCP V")).toBeNull();
  });
});

describe("listVerDirs", () => {
  it("lists staged versions newest-first, ignoring non-version entries", async () => {
    const cache = await tmpDir("scvn-mcpcache-");
    for (const name of ["Unity-MCP V0.82.3", "Unity-MCP V0.82.10", "Unity-MCP V0.82.4"]) {
      await mkdir(path.join(cache, name), { recursive: true });
    }
    await mkdir(path.join(cache, "unity-mcp-cli-0.82.4"), { recursive: true });
    await writeFile(path.join(cache, "stray.txt"), "x");

    expect(await listVerDirs(cache)).toEqual(["0.82.10", "0.82.4", "0.82.3"]);
  });

  it("returns [] when the cache does not exist", async () => {
    expect(await listVerDirs("/nonexistent/scvn/mcp")).toEqual([]);
  });
});
