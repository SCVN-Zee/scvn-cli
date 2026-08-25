/**
 * features/mcp/versions-json.ts — The per-version-dir ledger.
 *
 * `<cache>/Unity-MCP V<core>/versions.json`:
 *   { core, packages: {<pkg>: <ver>}, pins: {<addon>: bool}, fetchedAt }
 *
 * `packages` says what this version dir STAGED. It is NOT what a repo installed —
 * that is the repo's marker. The two are identical only by coincidence: several
 * repos can install different subsets of one staged version dir.
 *
 * `pins` records, per addon, whether it declared an exact dependency on THIS core.
 * Three states, and the absent one matters: a version dir staged before pin
 * tracking existed has no `pins` key at all and must be grandfathered through the
 * gate, never failed.
 *
 * Ports `central_pkgs` + the versions.json writer (unity-mcp-localize.sh:371,469).
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

export interface VersionsDoc {
  core: string;
  /** pkg → version, for everything this version dir staged. */
  packages: Record<string, string>;
  /**
   * addon → "does it pin this core?". Absent (undefined) for a dir that predates
   * pin tracking; core and ppx never appear (a pin is only meaningful for an addon).
   */
  pins?: Record<string, boolean>;
  fetchedAt: string;
}

export function versionsJsonPath(verDirPath: string): string {
  return path.join(verDirPath, "versions.json");
}

/** Read a version dir's ledger, or throw naming the dir. */
export async function readVersionsJson(verDirPath: string): Promise<VersionsDoc> {
  const file = versionsJsonPath(verDirPath);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `no versions.json in ${verDirPath} — the version is not staged; run: scvn mcp install`,
    );
  }

  let doc: VersionsDoc;
  try {
    doc = JSON.parse(raw) as VersionsDoc;
  } catch {
    throw new Error(`versions.json in ${verDirPath} is not valid JSON — inspect ${file}`);
  }

  if (!doc.packages || typeof doc.packages !== "object") {
    throw new Error(`versions.json in ${verDirPath} records no packages — inspect ${file}`);
  }
  return doc;
}

/** True when a version dir carries a complete ledger. */
export async function hasVersionsJson(verDirPath: string): Promise<boolean> {
  try {
    await readVersionsJson(verDirPath);
    return true;
  } catch {
    return false;
  }
}

export async function writeVersionsJson(
  verDirPath: string,
  doc: VersionsDoc,
): Promise<void> {
  await writeFile(versionsJsonPath(verDirPath), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

/** Package names a version dir staged, sorted so output is deterministic. */
export async function centralPkgs(verDirPath: string): Promise<string[]> {
  const doc = await readVersionsJson(verDirPath);
  return Object.keys(doc.packages).sort();
}

/**
 * Staged addons this dir recorded as NOT pinning its core, narrowed to `wanted`
 * when given. Empty means the dir is safe to install (or to bundle).
 *
 * Only an explicitly recorded `false` counts. An addon absent from `pins`, and a
 * dir with no `pins` key at all, are UNPROVEN — never skew. That is the same
 * grandfathering pin-gate.ts applies, for the same reason: a cache older than the
 * feature must not be treated as a broken one.
 */
export function skewedInDoc(doc: VersionsDoc, wanted?: readonly string[]): string[] {
  if (doc.pins === undefined) return [];
  return Object.entries(doc.pins)
    .filter(([pkg, pins]) => pins === false && (wanted === undefined || wanted.includes(pkg)))
    .map(([pkg]) => pkg)
    .sort();
}

/**
 * `skewedInDoc` for a version dir on disk. An unreadable or absent ledger yields
 * `[]`: we cannot prove skew, so we do not claim it.
 */
export async function skewedPkgs(
  verDirPath: string,
  wanted?: readonly string[],
): Promise<string[]> {
  try {
    return skewedInDoc(await readVersionsJson(verDirPath), wanted);
  } catch {
    return [];
  }
}
