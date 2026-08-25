/**
 * features/mcp/mcp-cache-paths.ts — Layout of the MCP version cache.
 *
 * ~/.scvn/mcp/
 *   Unity-MCP V0.82.4/          transformed package trees + versions.json + .tarballs/
 *   unity-mcp-cli-0.82.4/       the .mcp.json writer + its offline node_modules closure
 *
 * The version dirname carries a space, for parity with the bash original's
 * central staging folder. Every path is built here so that space is handled in
 * exactly one place — execa array args and fast-glob both cope with it, but only
 * because nothing ever interpolates these into a shell string.
 *
 * Only the most-recently-staged version is retained: every fetch prunes the
 * older `Unity-MCP V*` / `unity-mcp-cli-*` dirs (see pruneVerDirs/pruneCliDirs).
 * scvn does not keep older versions for offline rollback — `scvn mcp update
 * <older>` re-fetches from the registry.
 */

import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { getScvnDir } from "../../config/paths.js";
import { compareVersions } from "./semver-compare.js";

const VER_DIR_PREFIX = "Unity-MCP V";
const CLI_DIR_PREFIX = "unity-mcp-cli-";

/**
 * The user cache — `~/.scvn/mcp`. This is the only directory scvn ever WRITES a
 * fetched version into; a bundled cache is read-only (see resolve-mcp-cache.ts).
 */
export function userMcpCacheDir(scvnDirOverride?: string): string {
  return path.join(getScvnDir(scvnDirOverride), "mcp");
}

export function verDirName(coreVersion: string): string {
  return `${VER_DIR_PREFIX}${coreVersion}`;
}

export function verDir(coreVersion: string, cacheDir: string): string {
  return path.join(cacheDir, verDirName(coreVersion));
}

export function cliDirName(version: string): string {
  return `${CLI_DIR_PREFIX}${version}`;
}

export function cliDir(version: string, cacheDir: string): string {
  return path.join(cacheDir, cliDirName(version));
}

/**
 * The core version a dirname encodes, or null when it is not a version dir.
 * A bare `Unity-MCP V` is rejected: an empty version would flow downstream into
 * a `…--.tgz` download URL, which is how the bash original learned to guard it.
 */
export function parseVerDirName(name: string): string | null {
  if (!name.startsWith(VER_DIR_PREFIX)) return null;
  const version = name.slice(VER_DIR_PREFIX.length);
  return version.length > 0 ? version : null;
}

/** The CLI version a dirname encodes, or null when it is not a cli dir. */
export function parseCliDirName(name: string): string | null {
  if (!name.startsWith(CLI_DIR_PREFIX)) return null;
  const version = name.slice(CLI_DIR_PREFIX.length);
  return version.length > 0 ? version : null;
}

/** Directory names in `cacheDir`, or [] when it does not exist. */
async function listDirNames(cacheDir: string): Promise<string[]> {
  try {
    const entries = await readdir(cacheDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Staged core versions in `cacheDir`, newest-first. Absent cache → []. */
export async function listVerDirs(cacheDir: string): Promise<string[]> {
  return (await listDirNames(cacheDir))
    .map(parseVerDirName)
    .filter((version): version is string => version !== null)
    .sort((a, b) => compareVersions(b, a));
}

/** Cached unity-mcp-cli versions in `cacheDir`, newest-first. */
export async function listCliDirs(cacheDir: string): Promise<string[]> {
  return (await listDirNames(cacheDir))
    .map(parseCliDirName)
    .filter((version): version is string => version !== null)
    .sort((a, b) => compareVersions(b, a));
}

/**
 * Delete every staged dir in `cacheDir` that `select` maps to a version other
 * than `keep`. This is what bounds the user cache to a single version. Only ever
 * called on the user WRITE cache; a bundled cache is read-only and never passed.
 */
async function pruneOthers(
  cacheDir: string,
  select: (name: string) => string | null,
  keep: string,
): Promise<void> {
  const names = await listDirNames(cacheDir);
  await Promise.all(
    names.map(async (name) => {
      const version = select(name);
      if (version !== null && version !== keep) {
        await rm(path.join(cacheDir, name), { recursive: true, force: true });
      }
    }),
  );
}

/** Drop every staged version dir in `cacheDir` except `keep`. */
export function pruneVerDirs(cacheDir: string, keep: string): Promise<void> {
  return pruneOthers(cacheDir, parseVerDirName, keep);
}

/** Drop every cached unity-mcp-cli dir in `cacheDir` except `keep`. */
export function pruneCliDirs(cacheDir: string, keep: string): Promise<void> {
  return pruneOthers(cacheDir, parseCliDirName, keep);
}
