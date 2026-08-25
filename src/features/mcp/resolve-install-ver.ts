/**
 * features/mcp/resolve-install-ver.ts — Which core version an install targets.
 *
 *   explicit arg → newest core the addons can run → newest usable staged locally
 *
 * The middle step checks the registry for the latest core and then SOLVES it
 * against the addon set (resolve-coherent-core.ts). Taking dist-tags.latest
 * unconditionally is what used to hand the install a version no addon had a build
 * for, every time upstream published a core ahead of its addons.
 *
 * The last step is deliberate and belongs to INSTALL ONLY: with the registry
 * unreachable, installing whatever is already staged is exactly right — the
 * alternative is refusing to work on a plane with a perfectly good cache.
 *
 * `update` does NOT share it. A bump that silently resolves backwards is worse
 * than an error, so update refuses instead (see update-mcp.ts). Rollback there
 * stays explicit: `scvn mcp update <coreVer>`.
 *
 * Ports `resolve_install_ver` (unity-mcp-localize.sh:531).
 */

import { resolveCoherentCore, NoCoherentCoreError } from "./resolve-coherent-core.js";
import type { CoherentCoreOpts } from "./resolve-coherent-core.js";
import { newestStagedVersion } from "./resolve-mcp-cache.js";
import type { McpCacheOpts } from "./resolve-mcp-cache.js";

export interface ResolveInstallVerOpts extends CoherentCoreOpts, McpCacheOpts {}

export async function resolveInstallVersion(
  arg: string | undefined,
  addons: readonly string[],
  opts: ResolveInstallVerOpts = {},
): Promise<string> {
  if (arg) return arg;

  try {
    return await resolveCoherentCore(addons, opts);
  } catch (err: unknown) {
    // "These addons share no core" is an answer, not a connectivity failure.
    // Falling back to a local version would bury it and then fail at the gate.
    if (err instanceof NoCoherentCoreError) throw err;
    // Registry unreachable — fall back to what is already staged (incl. a bundle).
  }

  // --force buys runtime skew, so it must also buy a skewed STAGED version. This
  // is the offline path: refusing here would leave the documented escape hatch
  // unreachable on the one machine with no network to route around it.
  const local = await newestStagedVersion({
    ...opts,
    wantAddons: opts.force ? undefined : addons,
  });

  if (local === null) {
    // Distinguish an empty cache from one whose every version is skewed: telling
    // someone "nothing staged" while a version dir sits right there is a lie that
    // sends them looking in the wrong place. Name --force, not "drop --addons" —
    // the addon set is seeded by default, so dropping the flag changes nothing.
    const anyStaged = await newestStagedVersion(opts);
    throw new Error(
      anyStaged === null
        ? "registry unreachable and nothing staged locally — connect and retry"
        : `registry unreachable, and no staged version has a build of the requested addons ` +
          `(newest staged: v${anyStaged}).\n` +
          `  Connect and retry, or re-run with --force (installs v${anyStaged} and accepts runtime skew).`,
    );
  }

  opts.reporter?.onLog({
    ts: Date.now(),
    level: "warn",
    message: `registry unreachable — falling back to newest staged version v${local}`,
  });
  return local;
}
