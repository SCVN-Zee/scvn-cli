/**
 * features/store/bundled-store-paths.ts — Locate a CLI-bundled snapshot store.
 *
 * `make pack` ships a copy of the producer's `~/.scvn/store/` INTO the bundle
 * as a sibling of `dist/`/`templates/` (i.e. `<install-root>/store/`). On a
 * teammate's clean machine the user store is empty, so import/doctor fall back
 * to this bundled store.
 *
 * Unlike `templates/`, a bundled store is OPTIONAL — a plain dev checkout has
 * none — so absence resolves to null (treated downstream as "nothing staged"),
 * never an error. The probe anchors on the install root (the dir holding
 * `templates/`) and checks for a sibling `store/`, which avoids a false match
 * on the source tree's own `src/features/store/` directory.
 */

import path from "node:path";
import { access } from "node:fs/promises";
import { findInstallRoot } from "../../util/install-root.js";

/**
 * Name of the store directory inside an install root / bundle. Single source of
 * truth so the producer (`make pack`) stages into the exact dir this probe reads.
 */
export const BUNDLED_STORE_DIRNAME = "store";

// undefined = not yet probed, null = probed and absent
let _bundledStoreRoot: string | null | undefined;

/**
 * Absolute path to the bundled store root (`<install-root>/store`), or null
 * when no bundled store ships alongside this CLI install. Cached.
 *
 * `startDirOverride` drives the underlying install-root walk from an explicit
 * directory (for tests); an overridden probe is never cached.
 */
export async function bundledStoreRoot(startDirOverride?: string): Promise<string | null> {
  const useCache = startDirOverride === undefined;
  if (useCache && _bundledStoreRoot !== undefined) return _bundledStoreRoot;

  const root = await findInstallRoot(startDirOverride);
  let result: string | null = null;
  if (root !== null) {
    const candidate = path.join(root, BUNDLED_STORE_DIRNAME);
    try {
      await access(candidate);
      result = candidate;
    } catch {
      result = null;
    }
  }

  if (useCache) _bundledStoreRoot = result;
  return result;
}

/** True when a bundled store ships alongside this CLI install. */
export async function bundledStoreExists(): Promise<boolean> {
  return (await bundledStoreRoot()) !== null;
}

/** @internal Force the bundled store root, bypassing the probe (for tests). */
export function _setBundledStoreRootForTest(dir: string | null): void {
  _bundledStoreRoot = dir;
}

/** @internal Reset the bundled store cache (for tests). */
export function _resetBundledStoreCache(): void {
  _bundledStoreRoot = undefined;
}
