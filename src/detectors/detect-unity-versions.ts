/**
 * detectors/detect-unity-versions.ts — Find Unity editor installs under Unity Hub.
 *
 * Only returns versions that have a UnityYAMLMerge binary (required for smart merge).
 * The binary + spec locations differ by Unity version — the classic
 * `Contents/Tools/` layout (≤ 6000.0) and the relocated `Contents/Helpers/` +
 * `Contents/Resources/UnityYAMLMerge/` layout (6000.3+) are both probed, so the
 * stored yamlMergePath/mergeSpecPath always point at the paths that exist for
 * that editor. Results are sorted newest-first (numeric-aware) so 6000.10 ranks
 * above 6000.3.
 *
 * Ported from fork-unity-setup/src/detectors/detect-unity-versions.ts, extended
 * for the 6000.3 layout relocation.
 */

import fs from "fs/promises";
import path from "path";
import {
  UNITY_HUB_EDITOR_DIR,
  unityMergeSpecCandidates,
  unityYamlMergeCandidates,
} from "../lib/fork-paths.js";

export interface UnityVersionInfo {
  version: string;
  editorPath: string;
  yamlMergePath: string;
  mergeSpecPath: string;
}

/** Return the first candidate path that exists on disk, or null when none do. */
async function firstExisting(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // candidate absent — try the next layout
    }
  }
  return null;
}

export async function detectUnityVersions(
  hubDir: string = UNITY_HUB_EDITOR_DIR,
): Promise<UnityVersionInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(hubDir);
  } catch {
    return [];
  }

  const versions: UnityVersionInfo[] = [];
  for (const entry of entries) {
    const editorPath = path.join(hubDir, entry);
    // Skip anything without a merge binary in any known layout (not a usable editor).
    const yamlMergePath = await firstExisting(unityYamlMergeCandidates(editorPath));
    if (yamlMergePath === null) continue;
    // Spec ships alongside the binary; fall back to the classic path when a
    // broken install has the binary but no spec — doctor then reports it unreadable.
    const specCandidates = unityMergeSpecCandidates(editorPath);
    const mergeSpecPath = (await firstExisting(specCandidates)) ?? specCandidates[0]!;
    versions.push({ version: entry, editorPath, yamlMergePath, mergeSpecPath });
  }
  // Numeric-aware compare — a plain string sort ranks "6000.3" above "6000.10"
  // ("3" > "1") and mis-orders "9f1" vs "15f1" patch tails.
  versions.sort((left, right) =>
    right.version.localeCompare(left.version, undefined, { numeric: true }),
  );
  return versions;
}
