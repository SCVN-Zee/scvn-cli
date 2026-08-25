/**
 * features/setup/submodule-ignore-state.ts — Read/set the per-submodule
 * `ignore=dirty` state one submodule at a time, for the desktop Ignore-dirty
 * page's live toggles.
 *
 * This is the direct-manipulation sibling of toggle-submodule-ignore.ts (the
 * CLI's batch multi-select). Both share the same write model — the toggle
 * controls ONLY the local `.git/config` override (`set dirty` / `unset`), never
 * the tracked `.gitmodules`, so a GUI flip is byte-identical to `scvn
 * ignore-dirty` and round-trips cleanly.
 *
 * `readSubmoduleIgnoreState` additionally surfaces each submodule's `.gitmodules`
 * `ignore` value as read-only context: when it is `dirty`/`all` git is
 * effectively ignoring dirty content regardless of the local override, so the
 * UI can say so instead of misleadingly showing the toggle "off". The flag is
 * keyed on the submodule NAME (what git resolves `submodule.<name>.ignore` by),
 * while the PATH is what the UI displays.
 */

import {
  getRepoRoot,
  listSubmodules,
  getLocalConfig,
  setLocalConfig,
  unsetLocalConfig,
  listSubmoduleGitmodulesIgnore,
} from "../../services/git.js";

const ignoreKey = (submoduleName: string): string => `submodule.${submoduleName}.ignore`;

/** One submodule's ignore state, as shown in the Ignore-dirty page. */
export interface SubmoduleIgnoreRow {
  /** `.gitmodules` section name — git resolves `submodule.<name>.ignore` by this. */
  name: string;
  /** Working-tree path — what the UI displays. Equals `name` unless added with `--name`. */
  path: string;
  /** True when local `.git/config` sets `submodule.<name>.ignore=dirty` (what the toggle controls). */
  localDirty: boolean;
  /** The `.gitmodules` `ignore` value if declared there, else null (read-only context). */
  gitmodulesIgnore: string | null;
}

/** Result of enumerating a target's submodule ignore state. */
export type SubmoduleIgnoreState =
  | { status: "notRepo"; target: string }
  | { status: "noSubmodules"; repo: string }
  | { status: "ok"; repo: string; submodules: SubmoduleIgnoreRow[] };

/**
 * Enumerate every submodule of the repo containing `target` with its current
 * local override state and `.gitmodules` fallback. Never throws for the ordinary
 * "not a repo" / "no submodules" cases — they are returned as statuses.
 */
export async function readSubmoduleIgnoreState(target: string): Promise<SubmoduleIgnoreState> {
  const repo = await getRepoRoot(target);
  if (!repo) return { status: "notRepo", target };

  const subs = await listSubmodules(repo);
  if (subs.length === 0) return { status: "noSubmodules", repo };

  const gitmodulesIgnore = await listSubmoduleGitmodulesIgnore(repo);
  const submodules = await Promise.all(
    subs.map(async (s): Promise<SubmoduleIgnoreRow> => ({
      name: s.name,
      path: s.path,
      localDirty: (await getLocalConfig(repo, ignoreKey(s.name))) === "dirty",
      gitmodulesIgnore: gitmodulesIgnore[s.name] ?? null,
    })),
  );
  return { status: "ok", repo, submodules };
}

/** Result of a single-submodule toggle write. */
export type SetSubmoduleIgnoreResult =
  | { status: "notRepo"; target: string }
  | { status: "ok"; name: string; localDirty: boolean };

/**
 * Set (`ignored=true` → local `ignore=dirty`) or clear (`ignored=false` → unset
 * the local key) one submodule's override, keyed on its `.gitmodules` NAME.
 * Local `.git/config` only; never touches the tracked `.gitmodules`.
 */
export async function setSubmoduleIgnore(
  target: string,
  name: string,
  ignored: boolean,
): Promise<SetSubmoduleIgnoreResult> {
  const repo = await getRepoRoot(target);
  if (!repo) return { status: "notRepo", target };

  if (ignored) await setLocalConfig(repo, ignoreKey(name), "dirty");
  else await unsetLocalConfig(repo, ignoreKey(name));

  return { status: "ok", name, localDirty: ignored };
}
