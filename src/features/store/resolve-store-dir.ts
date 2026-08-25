/**
 * features/store/resolve-store-dir.ts — Pick the effective store root per feature.
 *
 * The store is read at two layers — the command guard/provenance layer (meta
 * read) and the import handlers (file mirror). Both MUST agree on one store
 * root or an import splits-brain (command reads user meta = null, handler reads
 * bundled). This resolver centralizes the precedence so callers resolve once
 * and thread the result to both:
 *
 *   explicit override → user store (if that feature's meta.json is present)
 *                     → CLI-bundled store (if one ships) → null (nothing staged)
 *
 * Precedence is keyed on meta.json presence — the apply-truth — never directory
 * existence: a half-cleaned empty slot (dir, no meta) must fall through to the
 * bundle, and an empty packages[] counts as nothing staged (parity with the
 * import flows). Export flows intentionally do NOT use this — they always write
 * the user store.
 */

import { getStoreDir } from "./store-paths.js";
import { readPackagesStoreMeta } from "./store-meta.js";
import { bundledStoreRoot } from "./bundled-store-paths.js";

export type StoreFeature = "packages";
export type StoreSource = "override" | "user" | "bundled";

export interface EffectiveStore {
  /** Store root to pass as the `storeDir` override to meta readers + handlers. */
  storeDir: string;
  /** Which source won — callers use this for the doctor "(bundled)" label. */
  source: StoreSource;
}

export interface ResolveStoreOpts {
  /** Explicit store root — wins outright (reserved for tests / a future flag). */
  override?: string;
  /** User store root to probe; defaults to ~/.scvn/store. Injectable for tests. */
  userStoreDir?: string;
}

/** Whether the user store has applyable content for this feature. */
async function userHasFeature(_feature: StoreFeature, userRoot: string): Promise<boolean> {
  // An empty packages[] is "nothing staged" — same rule as the import flows.
  const meta = await readPackagesStoreMeta(userRoot);
  return meta !== null && meta.packages.length > 0;
}

/**
 * Resolve the store root to use for a feature, or null when nothing is staged
 * anywhere (user store empty AND no bundled store).
 */
export async function resolveEffectiveStoreDir(
  feature: StoreFeature,
  opts: ResolveStoreOpts = {},
): Promise<EffectiveStore | null> {
  if (opts.override) {
    return { storeDir: opts.override, source: "override" };
  }

  const userRoot = opts.userStoreDir ?? getStoreDir();
  if (await userHasFeature(feature, userRoot)) {
    return { storeDir: userRoot, source: "user" };
  }

  const bundled = await bundledStoreRoot();
  if (bundled !== null) {
    return { storeDir: bundled, source: "bundled" };
  }

  return null;
}
