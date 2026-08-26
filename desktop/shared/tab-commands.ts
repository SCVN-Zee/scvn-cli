/**
 * desktop/shared/tab-commands.ts — Maps each tab (capability id) to the host
 * command keys it owns, plus the pure registry filter that build-time tab
 * selection (SCVN_TABS) applies. Kept dependency-free so both the host and the
 * guard test can import it without pulling in the command handlers.
 *
 * A key owned by no tab (SHARED_COMMAND_KEYS) is always kept: those are shared
 * infrastructure reachable from more than one tab (e.g. the project picker) or
 * the transport self-test. Selection only ever removes keys owned by a
 * *disabled* tab; the guard test keeps this map in sync with the real registry.
 */

/** Command keys each tab owns. Ids match CAPABILITIES entries. */
export const TAB_COMMAND_KEYS: Record<string, readonly string[]> = {
  fork: ["fork:prepare", "fork"],
  git: ["git", "ignore-dirty:list", "ignore-dirty:set"],
  mcp: ["mcp:project-status", "mcp"],
  packages: ["packages", "packages:resolve-source", "packages:list", "packages:remove"],
  settings: ["config:prepare", "config", "doctor"],
};

/**
 * Keys reachable regardless of selection: the transport self-test, the shared
 * project picker, and the per-feature template editor (owned by neither tab —
 * reachable from both the Git-setup ops and the Fork merge-attributes field, so
 * a subset build that drops one tab must not strip it from the other).
 */
export const SHARED_COMMAND_KEYS: readonly string[] = [
  "ping",
  "projects:discover",
  "templates:read",
  "templates:write",
  "templates:reset",
];

/**
 * Drop every key owned by a tab that `enabledIds` does not include. Keys not
 * owned by any tab are always kept. Pure over its inputs.
 */
export function selectRegistry<T>(
  registry: Record<string, T>,
  enabledIds: Iterable<string>,
): Record<string, T> {
  const enabled = new Set(enabledIds);
  const disabledKeys = new Set<string>();
  for (const [tab, keys] of Object.entries(TAB_COMMAND_KEYS)) {
    if (!enabled.has(tab)) for (const key of keys) disabledKeys.add(key);
  }
  const out: Record<string, T> = {};
  for (const [key, handler] of Object.entries(registry)) {
    if (!disabledKeys.has(key)) out[key] = handler;
  }
  return out;
}
