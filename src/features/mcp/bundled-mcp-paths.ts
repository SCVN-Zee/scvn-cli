/**
 * features/mcp/bundled-mcp-paths.ts — Locate a CLI-bundled MCP cache.
 *
 * `make pack` ships the producer's newest staged version dir + the unity-mcp-cli
 * closure INTO the bundle, as a sibling of `dist/`/`templates/` (i.e.
 * `<install-root>/mcp/`). That is what lets an artist with no network and no
 * `~/.scvn/mcp` still run `scvn mcp install`.
 *
 * Like the bundled store — and unlike `templates/` — a bundled cache is OPTIONAL:
 * a plain dev checkout has none, so absence resolves to null rather than an error.
 *
 * Verbatim shape of `features/store/bundled-store-paths.ts`.
 */

import path from "node:path";
import { access } from "node:fs/promises";
import { findInstallRoot } from "../../util/install-root.js";

/** Name of the MCP cache dir inside an install root. Producer and consumer share it. */
export const BUNDLED_MCP_DIRNAME = "mcp";

// undefined = not yet probed, null = probed and absent
let _bundledMcpRoot: string | null | undefined;

/**
 * Absolute path to the bundled MCP cache (`<install-root>/mcp`), or null when no
 * bundled cache ships alongside this CLI install. Cached.
 */
export async function bundledMcpRoot(startDirOverride?: string): Promise<string | null> {
  const useCache = startDirOverride === undefined;
  if (useCache && _bundledMcpRoot !== undefined) return _bundledMcpRoot;

  const root = await findInstallRoot(startDirOverride);
  let result: string | null = null;
  if (root !== null) {
    const candidate = path.join(root, BUNDLED_MCP_DIRNAME);
    try {
      await access(candidate);
      result = candidate;
    } catch {
      result = null;
    }
  }

  if (useCache) _bundledMcpRoot = result;
  return result;
}

/** @internal Force the bundled MCP root, bypassing the probe (for tests). */
export function _setBundledMcpRootForTest(dir: string | null): void {
  _bundledMcpRoot = dir;
}

/** @internal Reset the bundled MCP cache probe (for tests). */
export function _resetBundledMcpCache(): void {
  _bundledMcpRoot = undefined;
}
