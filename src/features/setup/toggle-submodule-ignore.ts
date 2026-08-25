/**
 * features/setup/toggle-submodule-ignore.ts — Toggle `submodule.<name>.ignore=dirty`
 * across every submodule in the git repo that contains `target`.
 *
 * One multi-select whose selection IS the desired final state:
 *   - preselected         = submodule currently has ignore=dirty
 *   - selected & unset    → set   ignore=dirty
 *   - deselected & set    → unset ignore
 *   - empty submitted set → unset ALL (desired state = nothing ignored)
 *
 * Esc/cancel never reaches the confirm seam — the prompt adapter does
 * process.exit(0) on cancel (ui/prompt.ts), so an empty Set here is ALWAYS an
 * intentional submit ("unset all"), never a cancel.
 *
 * The picker shows each submodule's PATH (what the user recognizes), but the
 * ignore flag is keyed on the submodule NAME — git resolves
 * `submodule.<name>.ignore` by the .gitmodules section name, which can differ
 * from the path when a submodule was added with `--name`.
 *
 * Pre-flight:
 *   - not a git repo                 → failed
 *   - no submodules (no .gitmodules) → skipped (exit 0 — nothing to do)
 *
 * opts.autoYes  — skip the multi-select, set ignore=dirty on every submodule
 * opts.dryRun   — report intended changes, write nothing
 * opts.confirm  — multi-select seam (required unless autoYes); empty Set = unset all
 * opts.reporter — status/log output seam
 */

import {
  getRepoRoot,
  listSubmodules,
  getLocalConfig,
  setLocalConfig,
  unsetLocalConfig,
} from "../../services/git.js";
import type { SyncReporter } from "../transfer/reporter.js";

// ---------------------------------------------------------------------------
// Seam types
// ---------------------------------------------------------------------------

export interface SubmoduleIgnoreItem {
  /** Submodule working-tree path — the picker's display label and Set identity. */
  label: string;
  /** True when the submodule currently has ignore=dirty. */
  preselected: boolean;
}

/**
 * Multi-select gate. The returned Set is the desired final state (which
 * submodule PATHS should be ignore=dirty). An EMPTY Set means "none" (unset all)
 * — cancel is handled upstream by the prompt adapter, so it never arrives here.
 */
export type SubmoduleConfirm = (
  title: string,
  items: SubmoduleIgnoreItem[],
) => Promise<Set<string>>;

export interface ToggleSubmoduleIgnoreOpts {
  autoYes?:  boolean;
  dryRun?:   boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
  /** Multi-select gate. Required unless autoYes=true. */
  confirm?:  SubmoduleConfirm;
}

const ignoreKey = (submoduleName: string) => `submodule.${submoduleName}.ignore`;

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function toggleSubmoduleIgnore(
  target: string,
  opts: ToggleSubmoduleIgnoreOpts = {},
): Promise<void> {
  const autoYes  = opts.autoYes ?? false;
  const dryRun   = opts.dryRun  ?? false;
  const reporter = opts.reporter;

  // Pre-flight: must be inside a git repo.
  const repo = await getRepoRoot(target);
  if (!repo) {
    reporter?.onStatus({ status: "failed", error: `Not a git repo: ${target}` });
    return;
  }

  // No submodules (or no .gitmodules) → nothing to do, not an error.
  const subs = await listSubmodules(repo);
  if (subs.length === 0) {
    reporter?.onStatus({ status: "skipped", detail: `no submodules in ${repo}` });
    return;
  }

  // Current ignore=dirty state per submodule (index-aligned with `subs`).
  // Keyed on NAME — that is what git reads for `submodule.<name>.ignore`.
  const ignored = await Promise.all(
    subs.map(async (s) => (await getLocalConfig(repo, ignoreKey(s.name))) === "dirty"),
  );

  reporter?.onStatus({ status: "running" });

  // Desired final state: the set of submodule PATHS that should be ignore=dirty.
  let desired: Set<string>;
  if (autoYes) {
    desired = new Set(subs.map((s) => s.path)); // -y: enable dirty-ignore everywhere
  } else {
    if (!opts.confirm) {
      throw new Error("toggleSubmoduleIgnore: opts.confirm is required in interactive mode");
    }
    desired = await opts.confirm(
      "Submodule ignore-dirty — pick submodules to mark ignore=dirty",
      subs.map((s, i) => ({ label: s.path, preselected: ignored[i]! })),
    );
  }

  // Dry-run: report intended changes, write nothing.
  if (dryRun) {
    let set = 0;
    let unset = 0;
    subs.forEach((s, i) => {
      const want = desired.has(s.path);
      if (want && !ignored[i]) {
        set++;
        reporter?.onLog({ ts: Date.now(), level: "info", message: `would set   ignore=dirty: ${s.path}` });
      } else if (!want && ignored[i]) {
        unset++;
        reporter?.onLog({ ts: Date.now(), level: "info", message: `would unset ignore: ${s.path}` });
      }
    });
    reporter?.onStatus({
      status: "done",
      detail: `[dry-run] ${set + unset} would change (${set} set, ${unset} unset)`,
    });
    return;
  }

  // Apply: the selection IS the desired final state. Identity = path, key = name.
  let applied = 0;
  let skipped = 0;
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i]!;
    const want = desired.has(s.path);
    if (want && !ignored[i]) {
      await setLocalConfig(repo, ignoreKey(s.name), "dirty");
      applied++;
    } else if (!want && ignored[i]) {
      await unsetLocalConfig(repo, ignoreKey(s.name));
      applied++;
    } else {
      skipped++;
    }
  }

  reporter?.onStatus({ status: "done", detail: `${applied} applied, ${skipped} skipped` });
}
