/**
 * features/setup/setup-merge-attributes.ts — Apply the Unity smart-merge
 * `.gitattributes` block to a project.
 *
 * This is the git-side half of Fork's Unity YAML merge setup: `scvn fork`
 * configures Fork.app's merge tool (machine-level), and this writes the
 * repo-root `.gitattributes` marker block (`# BEGIN/END fork-unity-setup`,
 * sourced from `templates/gitattributes-merge`) that tells git to route Unity
 * YAML types through `unityyamlmerge`. Without both halves the smart merge does
 * not engage. Non-destructive: a marker-block insert (foreign lines + the LFS
 * block, a distinct marker pair, are preserved) via writeGitAttributes.
 *
 * A non-git target is a clean skip (parity with setup-lfs/gitexclude), never a
 * failure. Resolves the enclosing repo root so the block lands at the repo root
 * regardless of whether an Assets dir was picked.
 */

import path from "node:path";
import { getRepoRoot } from "../../services/git.js";
import { writeGitAttributes } from "../../writers/write-gitattributes.js";

export type MergeAttributesResult =
  | { status: "skipped"; detail: string }
  | { status: "done"; detail: string };

export interface SetupMergeAttributesOpts {
  dryRun?: boolean;
}

export async function setupMergeAttributes(
  target: string,
  opts: SetupMergeAttributesOpts = {},
): Promise<MergeAttributesResult> {
  const dryRun = opts.dryRun ?? false;

  const repoRoot = await getRepoRoot(target);
  if (!repoRoot) {
    return { status: "skipped", detail: "no git repo" };
  }

  if (dryRun) {
    return {
      status: "done",
      detail: `would write Unity merge block to ${path.basename(repoRoot)}/.gitattributes`,
    };
  }

  const result = await writeGitAttributes({ projectPaths: [repoRoot] });
  const written = result.perProject[0]?.written ?? false;
  return {
    status: "done",
    detail: written
      ? "Unity merge .gitattributes synced"
      : "Unity merge .gitattributes up to date",
  };
}
