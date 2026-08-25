/**
 * features/mcp/addon-names.ts — Expand an `--addons` CSV into full package names.
 *
 * Ports `addon_set_from_csv` (unity-mcp-localize.sh:138). Bare shorthand
 * ("animation") expands into the com.ivanmurzak.unity.mcp.* namespace; a
 * fully-qualified name passes through.
 */

import { ADDON_NAMESPACE } from "./mcp-constants.js";

/**
 * The `--addons` shorthand a full package name came from, for messages. Anything
 * outside the addon namespace is returned whole rather than mangled.
 */
export function shortAddonName(pkg: string): string {
  return pkg.startsWith(ADDON_NAMESPACE) ? pkg.slice(ADDON_NAMESPACE.length) : pkg;
}

/**
 * Full addon package names from a comma-separated list, deduped, order preserved.
 */
export function expandAddonCsv(csv: string): string[] {
  const names: string[] = [];

  for (const entry of csv.split(",")) {
    const name = entry.trim();
    if (!name) continue;

    const full = name.startsWith("com.ivanmurzak.") ? name : `${ADDON_NAMESPACE}${name}`;
    if (!names.includes(full)) names.push(full);
  }

  return names;
}
