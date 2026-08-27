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

import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { deriveProjectName } from "../../util/paths.js";
import { exists } from "../../util/fs-predicates.js";
import { getPackagesStoreDir, getPackagesStoreMetaPath } from "./store-paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One package staged in the library, with its own provenance. */
export interface StagedPackage {
  label: string;
  /** Project-root-relative identity (`Assets/Plugins/Sirenix`, `Packages/com.acme.core`) */
  relPath: string;
  /** Staged size in bytes */
  bytes: number;
  /** Absolute path of the source project root this package came from */
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
  /** Store schema version — 2 = project-root-relative relPaths */
  version: 2;
  /** Packages currently staged in the library — authoritative list for import */
  packages: StagedPackage[];
}

// ---------------------------------------------------------------------------
// Migration: legacy single-slot shape → per-package provenance
// ---------------------------------------------------------------------------

/** The pre-library meta: one top-level provenance for the whole snapshot. */
interface LegacyPackagesMeta {
  kind: "packages";
  /** Store schema version — absent in v1 metas; 2 = project-root-relative */
  version?: number;
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
  return { kind: "packages", version: 2, packages };
}

// ---------------------------------------------------------------------------
// Migration: v1 Assets-relative identity → v2 project-root-relative
// ---------------------------------------------------------------------------

/**
 * v1→v2 identity migration. v1 relPaths were ASSETS-relative; v2 relPaths are
 * project-root-relative, so every v1 entry's new identity is mechanically
 * `Assets/<v1relPath>` (the on-disk `version` field — never the string prefix
 * — is the discriminator: a v1 `Assets/Foo` came from
 * `<root>/Assets/Assets/Foo` and becomes `Assets/Assets/Foo`).
 *
 * Mirrors relocate in TWO strictly separated phases through a staging
 * namespace OUTSIDE the mirror tree (`<store>/.packages-v2-staging`), because
 * in-place renames are unorderable: one package's OLD mirror can sit inside
 * another's NEW path (v1 `Assets/Foo` vs v1 `Foo/X` → `Assets/Foo/X`), so a
 * direct move silently carries the wrong tree. Phase 1 vacates the old
 * namespace into staging; only then does phase 2 fill `Assets/`. Both phases
 * walk OUTERMOST packages first (fewest segments) so a mirror nested inside
 * another package's mirror rides along and its own move reads as already
 * done.
 *
 * Crash safety: a `.packages-v2-phase1` marker (durable before any phase-2
 * move) records that the old namespace is vacated. Without it, a retry after
 * a crashed phase 2 would re-run phase 1 against FINAL v2 paths masquerading
 * as old v1 ones (`store/Assets/Foo` is v1-`Foo`'s final but v1-`Assets/Foo`'s
 * old mirror) and swap package contents. The caller persists the v2 meta only
 * after both phases, then removes the marker — the retry path is therefore
 * always: marker present → skip phase 1, resume phase 2, write v2 meta. A
 * v2-meta read opportunistically sweeps marker/staging left by a crash in the
 * tiny post-meta window. Single-writer store; power-loss windows are not
 * fsync-hardened (consistent with the rest of the store).
 */
async function migratePackagesToRootRelative(
  packages: StagedPackage[],
  storeDir?: string,
): Promise<StagedPackage[]> {
  const storeRoot   = getPackagesStoreDir(storeDir);
  const storeParent = path.dirname(storeRoot);
  const staging     = path.join(storeParent, ".packages-v2-staging");
  const marker      = path.join(storeParent, ".packages-v2-phase1");
  // Outermost mirrors first, both phases (see docblock).
  const outermost = [...packages].sort(
    (a, b) => a.relPath.split("/").length - b.relPath.split("/").length,
  );

  // Phase 1: old namespace → staging. Skipped once the marker says the old
  // namespace is vacated. A stale staging copy alongside a live old mirror
  // can only be junk from an aborted ancient run — drop it first.
  if (!(await exists(marker))) {
    for (const pkg of outermost) {
      const oldDir = path.join(storeRoot, pkg.relPath);
      if (await exists(oldDir)) {
        const stagedDir = path.join(staging, pkg.relPath);
        if (await exists(stagedDir)) {
          await rm(stagedDir, { recursive: true, force: true });
        }
        await mkdir(path.dirname(stagedDir), { recursive: true });
        await rename(oldDir, stagedDir);
      }
      const oldMeta  = `${oldDir}.meta`;
      const stagedMeta = path.join(staging, `${pkg.relPath}.meta`);
      if (await exists(oldMeta)) {
        // Sidecar-only entries (mirror dir deleted, .meta left) skip the dir
        // branch above — the sidecar destination still needs its parent.
        await mkdir(path.dirname(stagedMeta), { recursive: true });
        await rename(oldMeta, stagedMeta);
      }
    }
    await mkdir(storeParent, { recursive: true });
    await writeFile(marker, "", "utf8");
  }

  // Phase 2: staging → the new Assets/ namespace (resumable: sources already
  // moved read as missing and are skipped).
  for (const pkg of outermost) {
    const stagedDir = path.join(staging, pkg.relPath);
    if (await exists(stagedDir)) {
      const newDir = path.join(storeRoot, `Assets/${pkg.relPath}`);
      await mkdir(path.dirname(newDir), { recursive: true });
      await rename(stagedDir, newDir);
    }
    const stagedMeta = path.join(staging, `${pkg.relPath}.meta`);
    if (await exists(stagedMeta)) {
      const newMeta = path.join(storeRoot, `Assets/${pkg.relPath}.meta`);
      // Sidecar-only entries skip the dir branch — create the parent here too.
      await mkdir(path.dirname(newMeta), { recursive: true });
      await rename(stagedMeta, newMeta);
    }
  }
  await rm(staging, { recursive: true, force: true });

  // v1 sourcePath pointed at the source project's Assets dir; v2 records the
  // project root so it lines up with discovered roots (import exclusion).
  return packages.map((pkg) => ({
    ...pkg,
    relPath: `Assets/${pkg.relPath}`,
    sourcePath: pkg.sourcePath.endsWith("/Assets")
      ? pkg.sourcePath.slice(0, -"/Assets".length)
      : pkg.sourcePath,
  }));
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
  const normalized = normalizePackagesMeta(meta);
  const storeParent = path.dirname(getPackagesStoreDir(storeDir));
  if (meta.version === 2) {
    // Migration already completed but crashed in the tiny post-meta window —
    // sweep the phase marker + staging scratch it left behind (best-effort).
    await rm(path.join(storeParent, ".packages-v2-phase1"), { force: true }).catch(() => {});
    await rm(path.join(storeParent, ".packages-v2-staging"), { recursive: true, force: true }).catch(() => {});
    return normalized;
  }

  // v1 store (Assets-relative identity): move mirrors, then persist v2 before
  // handing the meta out. Every consumer (list/import/remove) reads through
  // here, so none ever operates on a v1 identity. The phase marker survives
  // until the v2 meta is durable so a crash-resume never mistakes final v2
  // paths for old v1 ones.
  const migrated: PackagesStoreMeta = {
    ...normalized,
    packages: await migratePackagesToRootRelative(normalized.packages, storeDir),
  };
  await writePackagesStoreMeta(migrated, storeDir);
  await rm(path.join(storeParent, ".packages-v2-phase1"), { force: true }).catch(() => {});
  return migrated;
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
 * Merge `entries` into the stored library by relPath (replace-or-insert), keeping
 * existing entries from other paths intact. Existing relPaths keep their
 * position; new relPaths are appended. Persists and returns the merged meta.
 */
export async function upsertPackagesStoreMeta(
  entries: StagedPackage[],
  storeDir?: string,
): Promise<PackagesStoreMeta> {
  const current = await readPackagesStoreMeta(storeDir);
  const byRelPath = new Map<string, StagedPackage>();
  const order: string[] = [];
  for (const p of current?.packages ?? []) {
    byRelPath.set(p.relPath, p);
    order.push(p.relPath);
  }
  for (const p of entries) {
    if (!byRelPath.has(p.relPath)) order.push(p.relPath);
    byRelPath.set(p.relPath, p);
  }
  const merged: PackagesStoreMeta = {
    kind: "packages",
    version: 2,
    packages: order.map((relPath) => byRelPath.get(relPath)!),
  };
  await writePackagesStoreMeta(merged, storeDir);
  return merged;
}

/**
 * Drop the named relPaths from the stored library. Persists the remaining entries
 * and returns the removed ones (their relPaths let the caller delete mirrors).
 * Paths not present are silently ignored.
 */
export async function removePackagesStoreEntries(
  relPaths: string[],
  storeDir?: string,
): Promise<StagedPackage[]> {
  const current = await readPackagesStoreMeta(storeDir);
  if (!current) return [];
  const drop = new Set(relPaths);
  const removed = current.packages.filter((p) => drop.has(p.relPath));
  if (removed.length === 0) return [];
  const kept = current.packages.filter((p) => !drop.has(p.relPath));
  await writePackagesStoreMeta({ kind: "packages", version: 2, packages: kept }, storeDir);
  return removed;
}
