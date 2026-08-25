/**
 * lib/fork-paths.ts — Constant paths and helpers for the fork-setup namespace.
 *
 * Renamed from fork-unity-setup's lib/paths.ts to avoid collision with
 * the sync namespace's util/paths.ts.
 */

import { homedir } from "os";
import path from "path";

// Fork 2.64 bundle id. Update here and in write-fork-prefs if Fork ever changes key names.
export const FORK_BUNDLE_ID = "com.DanPristupov.Fork";
export const FORK_PLIST = path.join(
  homedir(),
  "Library/Preferences/com.DanPristupov.Fork.plist",
);

export const BEYOND_COMPARE_PATH = "/Applications/Beyond Compare.app/Contents/MacOS/bcomp";

export const UNITY_HUB_EDITOR_DIR = "/Applications/Unity/Hub/Editor";

// Unity relocated the merge tool in 6000.3: `Contents/Tools/` was removed, the
// UnityYAMLMerge binary moved to `Contents/Helpers/`, and its spec files moved
// to `Contents/Resources/UnityYAMLMerge/`. Older editors (2022.x, 6000.0) still
// ship the classic `Contents/Tools/` layout, so both must be probed — the
// detector returns the first candidate that exists on disk. Candidates are
// ordered classic-first; every layout is internally complete (exec + spec live
// together per layout), so independent probing yields a matched pair.

/** UnityYAMLMerge executable candidates, classic layout first, 6000.3+ second. */
export function unityYamlMergeCandidates(editorPath: string): string[] {
  const contents = path.join(editorPath, "Unity.app/Contents");
  return [
    path.join(contents, "Tools/UnityYAMLMerge"),   // Unity ≤ 6000.0
    path.join(contents, "Helpers/UnityYAMLMerge"), // Unity 6000.3+
  ];
}

/** mergespecfile.txt candidates, classic layout first, 6000.3+ second. */
export function unityMergeSpecCandidates(editorPath: string): string[] {
  const contents = path.join(editorPath, "Unity.app/Contents");
  return [
    path.join(contents, "Tools/mergespecfile.txt"),                  // Unity ≤ 6000.0
    path.join(contents, "Resources/UnityYAMLMerge/mergespecfile.txt"), // Unity 6000.3+
  ];
}

export const MARKER_BEGIN = "# BEGIN fork-unity-setup";
export const MARKER_END = "# END fork-unity-setup";

export const BACKUP_SUFFIX = "fork-unity-setup.bak";
