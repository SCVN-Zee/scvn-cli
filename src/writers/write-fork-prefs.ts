/**
 * writers/write-fork-prefs.ts — Write Fork.app integration prefs via `defaults write`.
 *
 * Sets mergeTool=custom(8), custom UnityYAMLMerge path + args; leaves diff prefs untouched.
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

// Fork 2.66.6 custom merge tool rawValue, observed from Integration preferences.
const FORK_CUSTOM_MERGE_TOOL = 8;

const KEYS = {
  mergeSelector: "mergeTool",
  mergeCustomPath: "externalMergeToolCustomPath",
  mergeCustomArgs: "externalMergeToolCustomArguments",
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

export interface ForkPrefsInput {
  yamlMergePath: string;
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

  // Merge: explicit custom path pointing at the user-picked Unity's YAMLMerge.
  // Arguments MUST be written as a plist array (one argv per element); Fork
  // calls the tool as `<path> <arg0> <arg1> ...`. Writing args as a single
  // string would pass one giant quoted blob and silently break the merge.
  await writeString(KEYS.mergeCustomPath, input.yamlMergePath);
  await writeArray(KEYS.mergeCustomArgs, UNITY_MERGE_ARGS);
  await writeInt(KEYS.mergeSelector, FORK_CUSTOM_MERGE_TOOL);

  // Remove only our legacy merge key; all diff preferences belong to the user.
  await softExec("defaults", ["delete", FORK_BUNDLE_ID, "ExternalMergeTool"]);

  await softExec("killall", ["cfprefsd"]);

  return {
    backupPath,
    mergePathWritten: input.yamlMergePath,
  };
}
