/**
 * features/mcp/marker.ts — The per-repo lockfile.
 *
 * `<project>/Assets/UnityMCP/.scvn-mcp.json` is the SINGLE source of truth for
 * "is MCP installed here, and with exactly what". install requires it absent,
 * update requires it present — the two verbs never overlap.
 *
 * It records the exact package set, not just the core version, because several
 * repos install different subsets of one staged version dir. That is why `update`
 * reads the marker rather than `--addons`.
 *
 * DUAL-READ: repos wired by the retired bash script carry the legacy
 * `.unity-mcp-localize.json`. Those are read transparently and migrated to the
 * new name on the next write, so an installed repo never has to be reinstalled.
 */

import path from "node:path";
import { readFile, writeFile, rename, rm, mkdir, access } from "node:fs/promises";
import { WIRE_SUBDIR } from "./mcp-constants.js";

export const MARKER_NAME = ".scvn-mcp.json";
/** Written by the retired unity-mcp-localize.sh. Read, then replaced. */
export const LEGACY_MARKER_NAME = ".unity-mcp-localize.json";

export interface MarkerDoc {
  coreVersion: string;
  /** pkg → version, exactly what this repo installed. */
  packages: Record<string, string>;
  /** The version dir it came from (provenance, for humans). */
  source: string;
  importedAt: string;
}

/** The vendored-source import root inside a Unity project. */
export function importRoot(unityProjectDir: string): string {
  return path.join(unityProjectDir, WIRE_SUBDIR);
}

export function markerPath(unityProjectDir: string): string {
  return path.join(importRoot(unityProjectDir), MARKER_NAME);
}

export function legacyMarkerPath(unityProjectDir: string): string {
  return path.join(importRoot(unityProjectDir), LEGACY_MARKER_NAME);
}

async function readJson(file: string): Promise<MarkerDoc | null> {
  try {
    const doc = JSON.parse(await readFile(file, "utf8")) as MarkerDoc;
    return doc.coreVersion ? doc : null;
  } catch {
    return null;
  }
}

/** The repo's marker — the new name wins, the legacy one is the fallback. */
export async function readMarker(unityProjectDir: string): Promise<MarkerDoc | null> {
  return (
    (await readJson(markerPath(unityProjectDir))) ??
    (await readJson(legacyMarkerPath(unityProjectDir)))
  );
}

/** True when MCP is installed here (either marker name). */
export async function isInstalled(unityProjectDir: string): Promise<boolean> {
  for (const file of [markerPath(unityProjectDir), legacyMarkerPath(unityProjectDir)]) {
    try {
      await access(file);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/** The installed core version, or null when not installed / unparseable. */
export async function markerVersion(unityProjectDir: string): Promise<string | null> {
  return (await readMarker(unityProjectDir))?.coreVersion ?? null;
}

/** The exact package names this repo installed, sorted. */
export async function markerPackages(unityProjectDir: string): Promise<string[]> {
  const doc = await readMarker(unityProjectDir);
  return doc ? Object.keys(doc.packages ?? {}).sort() : [];
}

/** Write the marker, then drop any legacy one — the migration completes here. */
export async function writeMarker(
  unityProjectDir: string,
  doc: MarkerDoc,
): Promise<void> {
  const file = markerPath(unityProjectDir);
  await mkdir(path.dirname(file), { recursive: true });

  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  await rename(temp, file);

  await rm(legacyMarkerPath(unityProjectDir), { force: true });
}
