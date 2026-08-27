/**
 * features/mcp/check-updates.ts — Online coherent solve + per-package diff.
 *
 * The MCP tab's update check. One solve (`resolveCoherentCore` then
 * `resolveVersions`) so the versions shown equal what Install/Apply would
 * vendor. Fail-soft: a pin conflict or a dead registry is a result, never a
 * throw into the host boundary. The offline `mcp:project-status` path does
 * not come through here.
 *
 * Addon packuments are fetched in parallel (then reused via the packument
 * cache) with a hard overall timeout; a hang degrades to `offline: true`.
 */

import path from "node:path";
import {
  fetchPackument,
  latestVersion,
  PACKUMENT_TIMEOUT_MS,
} from "../../services/npm-registry.js";
import { OPENUPM_REGISTRY, CORE_PKG } from "./mcp-constants.js";
import { readMarker } from "./marker.js";
import {
  resolveCoherentCore,
  coreVersionOptions,
  NoCoherentCoreError,
} from "./resolve-coherent-core.js";
import { resolveVersions } from "./resolve-versions.js";
import type { ResolveOpts } from "./resolve-versions.js";
import type { McpCacheOpts } from "./resolve-mcp-cache.js";

// WIRE MIRROR: `PkgDelta` and `CheckUpdatesResult` are re-declared structurally
// in desktop/shared/commands.ts (which is dependency-free and cannot import from
// src). Keep the two in sync. The host handler in desktop/host/capabilities.ts
// annotates its return as the shared `CheckUpdatesResult`, so a feature-side
// field removal/narrowing fails to compile there — that boundary is the guard.
export interface PkgDelta {
  pkg: string;
  from: string | null;
  to: string;
}

export interface CheckUpdatesResult {
  /** The coherent solve for the requested set, or null when unresolved/offline. */
  resolved: { core: string; packages: Record<string, string> } | null;
  /** Set shares no core: which addons pin which cores (from conflictSummary). */
  conflict: string | null;
  /** Registry unreachable — the tab should fall back to the offline view. */
  offline: boolean;
  /** Marker map when a target is installed, else null. */
  current: Record<string, string> | null;
  /** Non-empty when resolved differs from current (or current is null → all "install"). */
  updates: PkgDelta[];
  /** Informational newest-published per addon (may pin a different core). */
  catalog: { addon: string; newestPublished: string | null }[];
  /**
   * The core package's true `dist-tags.latest` (e.g. `0.90.0`), independent of
   * the addon set. `resolved.core` may be capped BELOW this when the requested
   * add-ons have not published a build pinning the newest core yet — this field
   * lets the tab show that gap instead of mislabeling the capped core as latest.
   */
  coreNewestPublished: string | null;
  /** Published stable cores, newest-first — the version chooser's menu. */
  coreVersions: string[];
  /**
   * Of `coreVersions`, the ones every SELECTED add-on pins a build for. Picking
   * a core outside this set is the pin-skew `attachMcp` refuses without `force`;
   * empty when the add-ons share no core (every pick then needs the override).
   */
  compatibleCores: string[];
}

export async function checkUpdates(
  addons: readonly string[],
  opts: { target?: string; catalogAddons?: readonly string[] } & ResolveOpts & McpCacheOpts,
): Promise<CheckUpdatesResult> {
  const current = await readCurrent(opts.target);
  // The coherent solve is keyed on the SELECTED `addons`; the informational
  // catalog can span a wider menu (e.g. every pickable add-on) so the UI shows a
  // version next to each option, checked or not.
  const catalogAddons = opts.catalogAddons ?? addons;
  try {
    return await withTimeout(solve(addons, catalogAddons, opts, current), PACKUMENT_TIMEOUT_MS);
  } catch {
    return offlineResult(current, catalogAddons);
  }
}

async function solve(
  addons: readonly string[],
  catalogAddons: readonly string[],
  opts: ResolveOpts,
  current: Record<string, string> | null,
): Promise<CheckUpdatesResult> {
  const { addons: catalog, coreNewestPublished } = await fetchAddonCatalog(catalogAddons, opts);
  // The chooser menu + compatibility signal. Outside the inner try so a conflict
  // still yields a full menu; a registry failure throws → the outer offline path.
  const { published: coreVersions, compatible: compatibleCores } = await coreVersionOptions(
    addons,
    opts,
  );
  try {
    const candidateCore = await resolveCoherentCore(addons, opts);
    const resolvedList = await resolveVersions(candidateCore, addons, opts);
    const packages: Record<string, string> = {};
    for (const pkg of resolvedList) packages[pkg.name] = pkg.version;
    return {
      resolved: { core: candidateCore, packages },
      conflict: null,
      offline: false,
      current,
      updates: diffPackages(current, packages),
      catalog,
      coreNewestPublished,
      coreVersions,
      compatibleCores,
    };
  } catch (err) {
    if (err instanceof NoCoherentCoreError) {
      return {
        resolved: null,
        conflict: err.message,
        offline: false,
        current,
        updates: [],
        catalog,
        coreNewestPublished,
        coreVersions,
        compatibleCores,
      };
    }
    return {
      resolved: null,
      conflict: null,
      offline: true,
      current,
      updates: [],
      catalog,
      coreNewestPublished,
      coreVersions,
      compatibleCores,
    };
  }
}

/**
 * Newest published version per addon, plus the core's own `dist-tags.latest`.
 * Fetches addon packuments in parallel with the core packument (so the
 * subsequent solve is a cache hit); a failed packument is `null`, not a throw.
 */
async function fetchAddonCatalog(
  catalogAddons: readonly string[],
  opts: ResolveOpts,
): Promise<{
  addons: { addon: string; newestPublished: string | null }[];
  coreNewestPublished: string | null;
}> {
  const corePrefetch = fetchPackument(OPENUPM_REGISTRY, CORE_PKG, opts)
    .then((packument) => {
      try {
        return latestVersion(packument, CORE_PKG);
      } catch {
        return null;
      }
    })
    .catch(() => null);
  const addonCatalog = await Promise.all(
    catalogAddons.map(async (addon) => {
      try {
        const packument = await fetchPackument(OPENUPM_REGISTRY, addon, opts);
        try {
          return { addon, newestPublished: latestVersion(packument, addon) };
        } catch {
          return { addon, newestPublished: null };
        }
      } catch {
        return { addon, newestPublished: null };
      }
    }),
  );
  return { addons: addonCatalog, coreNewestPublished: await corePrefetch };
}

/** The picker value is the Assets dir; the marker lives at the project root. */
async function readCurrent(
  target: string | undefined,
): Promise<Record<string, string> | null> {
  if (!target) return null;
  const marker = await readMarker(path.dirname(target));
  return marker?.packages ?? null;
}

function diffPackages(
  current: Record<string, string> | null,
  resolved: Record<string, string>,
): PkgDelta[] {
  const updates: PkgDelta[] = [];
  for (const [pkg, to] of Object.entries(resolved)) {
    const from = current?.[pkg] ?? null;
    if (from !== to) updates.push({ pkg, from, to });
  }
  return updates;
}

function offlineResult(
  current: Record<string, string> | null,
  addons: readonly string[],
): CheckUpdatesResult {
  return {
    resolved: null,
    conflict: null,
    offline: true,
    current,
    updates: [],
    catalog: addons.map((addon) => ({ addon, newestPublished: null })),
    coreNewestPublished: null,
    coreVersions: [],
    compatibleCores: [],
  };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`check-updates timed out after ${ms}ms`));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
