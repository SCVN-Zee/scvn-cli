/**
 * writers/write-fork-prefs.ts — Write Fork.app integration prefs via `defaults write`.
 *
 * Sets externalDiffTool=beyondCompare(1), mergeTool=custom(8), custom UnityYAMLMerge path + args.
 * Cleans up legacy keys from prior writer revisions.
 * Backs up the plist before any write.
 *
 * Ported from fork-unity-setup/src/writers/write-fork-prefs.ts.
 * Import paths updated to scvn lib/fork-paths and lib/backup.
 */

import { execa } from "execa";
import { FORK_BUNDLE_ID, FORK_PLIST } from "../lib/fork-paths.js";
import { backupFile } from "../lib/backup.js";
import { quitForkApp, FORK_QUIT_TIMEOUT_MESSAGE } from "../lib/quit-fork.js";

// Fork 2.66.6 diff/merge tool enum rawValues — observed empirically from a
// live install. These are compile-time constants in Fork's Swift source, so
// they're stable across machines running the same Fork version. Re-derive
// for future Fork versions: set the dropdown in Integration prefs to the
// target option, quit Fork, then `defaults read com.DanPristupov.Fork
// mergeTool externalDiffTool`.
export const FORK_TOOL_ENUM = {
  fileMerge: 0,
  beyondCompare: 1,
  custom: 8,
  unity3d: 9,
} as const;

const KEYS = {
  diffSelector: "externalDiffTool",
  mergeSelector: "mergeTool",
  mergeCustomPath: "externalMergeToolCustomPath",
  mergeCustomArgs: "externalMergeToolCustomArguments",
  diffCustomPath: "externalDiffToolCustomPath",
  diffCustomArgs: "externalDiffToolCustomArguments",
} as const;

// UnityYAMLMerge invocation: each argv goes in a separate array element.
// Fork calls: <path> <arg1> <arg2> … so we must NOT pre-concat.
const UNITY_MERGE_ARGS = [
  "merge",
  "-p",
  "$BASE",
  "$REMOTE",
  "$LOCAL",
  "$MERGED",
];

const LEGACY_DICT_KEYS = ["ExternalDiffTool", "ExternalMergeTool"] as const;
const LEGACY_CUSTOM_KEYS = [
  KEYS.diffCustomPath,
  KEYS.diffCustomArgs,
] as const;

export interface ForkPrefsInput {
  yamlMergePath: string;
  /** When true, set Fork's diff tool to Beyond Compare; when false, leave the diff pref untouched. */
  setupBeyondCompare: boolean;
}

export interface ForkPrefsResult {
  backupPath: string;
  mergePathWritten: string;
}

// Wraps execa in reject:false + try/catch for commands whose failure is
// non-fatal (best-effort quit, cache flush, legacy-key cleanup).
async function softExec(command: string, args: string[]): Promise<void> {
  try {
    await execa(command, args, { reject: false });
  } catch {
    // soft fail — binary missing or similar
  }
}

async function writeInt(key: string, value: number): Promise<void> {
  await execa("defaults", [
    "write",
    FORK_BUNDLE_ID,
    key,
    "-int",
    String(value),
  ]);
}

async function writeString(key: string, value: string): Promise<void> {
  await execa("defaults", ["write", FORK_BUNDLE_ID, key, "-string", value]);
}

async function writeArray(key: string, values: string[]): Promise<void> {
  await execa("defaults", [
    "write",
    FORK_BUNDLE_ID,
    key,
    "-array",
    ...values,
  ]);
}

export async function writeForkPrefs(
  input: ForkPrefsInput,
): Promise<ForkPrefsResult> {
  // Belt-and-suspenders: forkExecute already quit-and-waits before calling
  // us, but the user could relaunch Fork in between. A fire-and-forget quit
  // is not enough — Fork's on-quit prefs flush would race our writes — so
  // wait for the exit and refuse to write if Fork will not leave.
  const quit = await quitForkApp();
  if (quit === "timeout") throw new Error(FORK_QUIT_TIMEOUT_MESSAGE);

  const backupPath = await backupFile(FORK_PLIST);

  // Diff: Fork's built-in beyondCompare enum auto-discovers Beyond Compare via
  // bundle id. Only written when the caller opted in — when skipped, any
  // existing externalDiffTool pref is left untouched (skip ≠ reset). The
  // preflight guarantees Beyond Compare is installed whenever this runs.
  if (input.setupBeyondCompare) {
    await writeInt(KEYS.diffSelector, FORK_TOOL_ENUM.beyondCompare);
  }

  // Merge: explicit custom path pointing at the user-picked Unity's YAMLMerge.
  // Arguments MUST be written as a plist array (one argv per element); Fork
  // calls the tool as `<path> <arg0> <arg1> ...`. Writing args as a single
  // string would pass one giant quoted blob and silently break the merge.
  await writeString(KEYS.mergeCustomPath, input.yamlMergePath);
  await writeArray(KEYS.mergeCustomArgs, UNITY_MERGE_ARGS);
  await writeInt(KEYS.mergeSelector, FORK_TOOL_ENUM.custom);

  // Clean up legacy / stale keys from prior writer revisions.
  for (const legacyKey of [...LEGACY_CUSTOM_KEYS, ...LEGACY_DICT_KEYS]) {
    await softExec("defaults", ["delete", FORK_BUNDLE_ID, legacyKey]);
  }

  await softExec("killall", ["cfprefsd"]);

  return {
    backupPath,
    mergePathWritten: input.yamlMergePath,
  };
}
