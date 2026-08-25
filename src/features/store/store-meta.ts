/**
 * features/store/store-meta.ts — Provenance metadata for the packages library.
 *
 * The store is a LIBRARY: meta.json holds a list of staged packages, each
 * carrying its own provenance (source project, branch, when it was staged, size).
 * Packages accumulate across `scvn packages add` runs from different projects;
 * `remove` drops individual entries. The staged list — not the store directory
 * contents — is the truth at import time.
 *
 * Readers are failure-tolerant: missing file, unreadable JSON, kind mismatch, or
 * a non-array `packages` all yield null (callers treat null as "nothing staged").
 * A legacy single-slot meta (one top-level provenance + packages without their
 * own provenance) is migrated on read by copying that provenance onto each
 * package, so already-shipped stores keep working. Writers create the slot dir.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { deriveProjectName } from "../../util/paths.js";
import { getPackagesStoreMetaPath } from "./store-paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One package staged in the library, with its own provenance. */
export interface StagedPackage {
  label: string;
  relPath: string;
  /** Staged size in bytes */
  bytes: number;
  /** Absolute path of the source project (Assets dir) this package came from */
  sourcePath: string;
  /** Display name of the source project */
  sourceName: string;
  /** Git branch of the source repo when this package was staged, or null */
  branch: string | null;
  /** ISO 8601 timestamp of when this package was added to the library */
  stagedAt: string;
}

export interface PackagesStoreMeta {
  kind: "packages";
  /** Packages currently staged in the library — authoritative list for import */
  packages: StagedPackage[];
}

// ---------------------------------------------------------------------------
// Migration: legacy single-slot shape → per-package provenance
// ---------------------------------------------------------------------------

/** The pre-library meta: one top-level provenance for the whole snapshot. */
interface LegacyPackagesMeta {
  kind: "packages";
  sourcePath?: string;
  sourceName?: string;
  branch?: string | null;
  exportedAt?: string;
  bytes?: number;
  packages: Array<{ label: string; relPath: string; bytes?: number } & Partial<StagedPackage>>;
}

const EPOCH = new Date(0).toISOString();

/** Normalize a parsed, kind-checked meta (new or legacy) to the library shape. */
function normalizePackagesMeta(raw: LegacyPackagesMeta): PackagesStoreMeta {
  const packages: StagedPackage[] = raw.packages.map((p) => {
    // New-shape entries already carry their own provenance (keyed on stagedAt).
    if (typeof p.stagedAt === "string" && typeof p.sourcePath === "string") {
      return {
        label:      p.label,
        relPath:    p.relPath,
        bytes:      typeof p.bytes === "number" ? p.bytes : 0,
        sourcePath: p.sourcePath,
        sourceName: typeof p.sourceName === "string" ? p.sourceName : deriveProjectName(p.sourcePath),
        branch:     p.branch ?? null,
        stagedAt:   p.stagedAt,
      };
    }
    // Legacy entry: inherit the snapshot-level provenance.
    const sourcePath = raw.sourcePath ?? "";
    return {
      label:      p.label,
      relPath:    p.relPath,
      bytes:      typeof p.bytes === "number" ? p.bytes : 0,
      sourcePath,
      sourceName: raw.sourceName ?? (sourcePath ? deriveProjectName(sourcePath) : "unknown"),
      branch:     raw.branch ?? null,
      stagedAt:   raw.exportedAt ?? EPOCH,
    };
  });
  return { kind: "packages", packages };
}

// ---------------------------------------------------------------------------
// Reader / writer
// ---------------------------------------------------------------------------

export async function readPackagesStoreMeta(storeDir?: string): Promise<PackagesStoreMeta | null> {
  let raw: string;
  try {
    raw = await readFile(getPackagesStoreMetaPath(storeDir), "utf8");
  } catch {
    return null; // missing slot — nothing staged
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt JSON — treat as nothing staged
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  if (!("kind" in parsed) || parsed.kind !== "packages") return null;
  // packages[] drives recursive deletes at import/remove time — a kind-correct
  // meta without a real array is treated as nothing staged, not a crash.
  if (!("packages" in parsed) || !Array.isArray(parsed.packages)) return null;

  // Shape validated above (kind + packages array); the union covers new + legacy.
  const meta: LegacyPackagesMeta = parsed as LegacyPackagesMeta;
  return normalizePackagesMeta(meta);
}

export async function writePackagesStoreMeta(
  meta: PackagesStoreMeta,
  storeDir?: string,
): Promise<void> {
  const metaPath = getPackagesStoreMetaPath(storeDir);
  await mkdir(path.dirname(metaPath), { recursive: true });
  await writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Library mutations
// ---------------------------------------------------------------------------

/**
 * Merge `entries` into the stored library by label (replace-or-insert), keeping
 * existing entries from other sources intact. Existing labels keep their
 * position; new labels are appended. Persists and returns the merged meta.
 */
export async function upsertPackagesStoreMeta(
  entries: StagedPackage[],
  storeDir?: string,
): Promise<PackagesStoreMeta> {
  const current = await readPackagesStoreMeta(storeDir);
  const byLabel = new Map<string, StagedPackage>();
  const order: string[] = [];
  for (const p of current?.packages ?? []) {
    byLabel.set(p.label, p);
    order.push(p.label);
  }
  for (const p of entries) {
    if (!byLabel.has(p.label)) order.push(p.label);
    byLabel.set(p.label, p);
  }
  const merged: PackagesStoreMeta = {
    kind: "packages",
    packages: order.map((label) => byLabel.get(label)!),
  };
  await writePackagesStoreMeta(merged, storeDir);
  return merged;
}

/**
 * Drop the named labels from the stored library. Persists the remaining entries
 * and returns the removed ones (their relPaths let the caller delete mirrors).
 * Labels not present are silently ignored.
 */
export async function removePackagesStoreEntries(
  labels: string[],
  storeDir?: string,
): Promise<StagedPackage[]> {
  const current = await readPackagesStoreMeta(storeDir);
  if (!current) return [];
  const drop = new Set(labels);
  const removed = current.packages.filter((p) => drop.has(p.label));
  if (removed.length === 0) return [];
  const kept = current.packages.filter((p) => !drop.has(p.label));
  await writePackagesStoreMeta({ kind: "packages", packages: kept }, storeDir);
  return removed;
}
