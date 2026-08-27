/**
 * features/mcp/resolve-coherent-core.ts — The newest core the requested addons can run.
 *
 * Upstream publishes core FIRST and rebuilds the addons days later, so core's
 * dist-tags.latest routinely names a version no addon has a build for yet. Taking
 * it anyway is what produced the failure this module deletes: resolve latest →
 * download four tarballs → refuse at the install gate. Not a one-off — that window
 * reopens after every single core release.
 *
 * So the core is SOLVED against the addon set rather than picked and validated
 * afterwards: intersect the cores each requested addon pins, take the newest.
 * pin-gate.ts stays as the backstop for the paths that never come through here —
 * an explicit `install <coreVer>`, a hand-edited marker, a bundle staged elsewhere.
 *
 * EXACT pins only, matching resolveAddonVersion's `=== coreVersion`. An addon that
 * declares a range (or no core dep at all) constrains NOTHING rather than
 * excluding everything: there is no evidence it forbids a version, and reading
 * "unknown" as "impossible" would hard-block an install over a dependency shape
 * upstream has never actually published.
 */

import {
  fetchPackument,
  latestVersion,
  dependenciesOf,
  allVersions,
} from "../../services/npm-registry.js";
import type { Packument } from "../../services/npm-registry.js";
import { OPENUPM_REGISTRY, CORE_PKG } from "./mcp-constants.js";
import { shortAddonName } from "./addon-names.js";
import { semverMax, isPrerelease, compareVersions } from "./semver-compare.js";
import type { ResolveOpts } from "./resolve-versions.js";

/**
 * A whole exact version and nothing else — `0.84.2`, `0.84.2-rc.1`.
 *
 * A leading-digit test is NOT enough, and the difference is a hard block rather
 * than a near miss: `0.83.1 || 0.84.2` and `0.83.1 - 0.84.2` are legal npm RANGES
 * that start with a digit. Admitting one as a "pin" adds a literal that matches no
 * published version, empties the intersection, and tells the user to drop an addon
 * — over an addon that supports MORE cores, not fewer.
 */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

/**
 * The requested addons share no core at all.
 *
 * Distinct from a network failure on purpose: install's offline fallback must not
 * paper this over with a stale local version. It is an ANSWER — no version of this
 * set exists — not a connectivity problem, and retrying elsewhere cannot fix it.
 */
export class NoCoherentCoreError extends Error {
  override readonly name = "NoCoherentCoreError";
}

export interface CoherentCoreOpts extends ResolveOpts {
  /**
   * Accept a core NO addon pins, when the set has no coherent answer at all.
   * Mirrors pin-gate.ts's `--force`: it buys runtime skew, and refusing here
   * would make the gate's own escape hatch unreachable on the default path.
   *
   * It does NOT mean "prefer skew" — a coherent core still wins when one exists.
   */
  force?: boolean;
}

function log(opts: CoherentCoreOpts, level: "info" | "warn", message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

/** Every core version this addon publishes an exact-pinned build for. */
function pinnedCores(packument: Packument): Set<string> {
  const cores = new Set<string>();
  for (const version of allVersions(packument)) {
    const declared = dependenciesOf(packument, version)[CORE_PKG];
    if (declared !== undefined && EXACT_VERSION.test(declared)) cores.add(declared);
  }
  return cores;
}

/** "no core serves this set", plus what each addon actually pins. */
function conflictSummary(pinsByAddon: Map<string, Set<string>>): string {
  const lines = [...pinsByAddon].map(
    ([addon, cores]) => `    ${shortAddonName(addon)} — newest core it pins: ${semverMax([...cores])}`,
  );
  return `no core version has a build of every requested addon:\n${lines.join("\n")}`;
}

/**
 * The newest core version EVERY addon in `addons` publishes a build for.
 *
 * An empty set (or one where nothing declares an exact pin) is unconstrained and
 * resolves to dist-tags.latest — the pre-existing behavior, kept for the no-addon
 * install.
 */
export async function resolveCoherentCore(
  addons: readonly string[],
  opts: CoherentCoreOpts = {},
): Promise<string> {
  const corePackument = await fetchPackument(OPENUPM_REGISTRY, CORE_PKG, opts);
  const latest = latestVersion(corePackument, CORE_PKG);
  if (addons.length === 0) return latest;

  // Only cores the registry still publishes can be answers: a pin can name a
  // version that was yanked, or one the addon shipped ahead of.
  //
  // Prereleases are excluded because this is the UNNAMED path: `scvn mcp install`
  // must never silently land on a beta just because an addon pinned one and it
  // sorts highest. semver-compare.ts holds the same line for the bundled CLI
  // closure. Naming the version explicitly still installs it.
  const published = allVersions(corePackument).filter((version) => !isPrerelease(version));
  if (published.length === 0) {
    throw new Error(
      `registry publishes no stable versions of '${CORE_PKG}' — is the packument intact?`,
    );
  }

  const pinsByAddon = new Map<string, Set<string>>();

  for (const addon of addons) {
    const packument = await fetchPackument(OPENUPM_REGISTRY, addon, opts);
    const cores = pinnedCores(packument);
    if (cores.size === 0) {
      log(
        opts,
        "warn",
        `${shortAddonName(addon)} declares no exact ${CORE_PKG} pin — ` +
          `it cannot constrain the core choice (the install gate still checks it)`,
      );
      continue;
    }
    pinsByAddon.set(addon, cores);
  }

  if (pinsByAddon.size === 0) return latest;

  let candidates = published;
  for (const cores of pinsByAddon.values()) {
    candidates = candidates.filter((version) => cores.has(version));
  }

  const best = semverMax(candidates);
  if (best === null) {
    if (opts.force) {
      log(
        opts,
        "warn",
        `${conflictSummary(pinsByAddon)}\n  --force: using core ${latest} anyway — ` +
          `MCP tools may fail at runtime`,
      );
      return latest;
    }
    throw new NoCoherentCoreError(
      `${conflictSummary(pinsByAddon)}\n` +
        `  Install them into separate projects, drop one from --addons, or re-run with ` +
        `--force (accepts runtime skew).`,
    );
  }

  if (best !== latest) {
    log(
      opts,
      "info",
      `core ${latest} is the newest published, but no build of ` +
        `${[...pinsByAddon.keys()].map(shortAddonName).join(", ")} pins it yet — ` +
        `installing the newest core they all support: ${best}`,
    );
  }
  return best;
}

/**
 * The version chooser's menu and its compatibility signal. `published` is every
 * stable core the registry serves, newest-first. `compatible` is the subset that
 * EVERY addon in `addons` pins a build for — picking a `published` core outside
 * it is exactly the pin-skew `attachMcp` refuses without `force`. An empty (or
 * pin-less) addon set is unconstrained: every published core is compatible.
 *
 * Prereleases are excluded for the same reason `resolveCoherentCore` excludes
 * them: the chooser must not offer a beta as if it were a normal target.
 */
export async function coreVersionOptions(
  addons: readonly string[],
  opts: CoherentCoreOpts = {},
): Promise<{ published: string[]; compatible: string[] }> {
  const corePackument = await fetchPackument(OPENUPM_REGISTRY, CORE_PKG, opts);
  const published = allVersions(corePackument)
    .filter((version) => !isPrerelease(version))
    .sort(compareVersions)
    .reverse();
  if (addons.length === 0) return { published, compatible: published };

  const pinSets: Set<string>[] = [];
  for (const addon of addons) {
    const packument = await fetchPackument(OPENUPM_REGISTRY, addon, opts);
    const cores = pinnedCores(packument);
    if (cores.size > 0) pinSets.push(cores);
  }
  if (pinSets.length === 0) return { published, compatible: published };

  const compatible = published.filter((version) => pinSets.every((cores) => cores.has(version)));
  return { published, compatible };
}
