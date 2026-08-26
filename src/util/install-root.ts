/**
 * util/install-root.ts — Locate the tool's install root at runtime.
 *
 * The install root is the directory that holds the bundled `templates/` dir.
 * In a produced bundle (`make pack`) the same dir also holds `bin/`, `dist/`,
 * and `store/` as siblings, so every bundled-asset probe resolves relative to
 * it. At runtime the CLI is `<root>/dist/cli.mjs` (or `<root>/src/...` under
 * tsx in dev); we walk up from this module to the first ancestor containing a
 * `templates/` folder.
 *
 * Templates always ship (committed in the repo, copied into every bundle), so
 * the root is normally found; a missing root resolves to null and each caller
 * decides how to treat it (template resolution throws; the optional bundled
 * store treats null as "nothing staged").
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { stat } from "node:fs/promises";

// undefined = not yet probed, null = probed and not found
let _installRoot: string | null | undefined;

/**
 * Locate the install root (nearest ancestor dir containing `templates/`).
 * Cached after the first probe. Returns null when no such ancestor exists.
 *
 * `startDirOverride` drives the walk from an explicit directory (for tests);
 * an overridden walk is never cached so it cannot pollute the real probe.
 */
export async function findInstallRoot(startDirOverride?: string): Promise<string | null> {
  const useCache = startDirOverride === undefined;
  if (useCache && _installRoot !== undefined) return _installRoot;

  let dir = startDirOverride ?? path.dirname(fileURLToPath(import.meta.url));
  let found: string | null = null;

  // Walk up at most 6 levels (dist/ → root, or src/util/ → root, plus slack).
  // Probe with stat (not access): Electron's asar filesystem shim returns
  // ENOENT for access() on a *directory* inside an .asar, but stat() resolves
  // it correctly. The desktop host runs from an asar path, so an access-based
  // probe silently fails there and the root never resolves.
  for (let i = 0; i < 6; i++) {
    try {
      const entry = await stat(path.join(dir, "templates"));
      if (entry.isDirectory()) {
        found = dir;
        break;
      }
    } catch {
      // templates/ not here — fall through to walk up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  if (useCache) _installRoot = found;
  return found;
}

/** @internal Reset the cached install root (for tests). */
export function _resetInstallRoot(): void {
  _installRoot = undefined;
}
