/**
 * commands/shared/select-packages.ts — Staged-package selection prompts.
 *
 * selectStagedPackages — which staged packages to apply on import. Reads
 *   meta.packages (never a catalog): meta.json is the apply-truth at import time.
 * selectStagedPackagesToRemove — which staged packages to drop from the library
 *   (nothing preselected — the user opts each one in).
 *
 * Selection keys on relPath (project-root-relative identity); label is display-only.
 */

import type { PromptAdapter } from "../../ui/prompt.js";
import type { PackagesStoreMeta, StagedPackage } from "../../features/store/store-meta.js";

/** Multiselect label — disambiguates when basenames collide across root folders. */
function packageSelectLabel(p: StagedPackage, all: readonly StagedPackage[]): string {
  const dupes = all.filter((x) => x.label === p.label).length > 1;
  return dupes ? `${p.label} (${p.relPath})` : p.label;
}

/** Pick which staged packages to apply — default ALL staged. */
export async function selectStagedPackages(
  meta: PackagesStoreMeta,
  autoYes: boolean,
  prompt: PromptAdapter,
  /** GUI-page pre-collected relPaths: when set, skip the prompt entirely. */
  preselected?: string[],
): Promise<StagedPackage[]> {
  const allRelPaths = meta.packages.map((p) => p.relPath);

  const selectedRelPaths = preselected
    ? preselected
    : autoYes
      ? allRelPaths
      : await prompt.multiselect({
          message: "Select staged packages to import",
          options: meta.packages.map((p) => ({
            value: p.relPath,
            label: packageSelectLabel(p, meta.packages),
          })),
          initialValues: allRelPaths,
          required: false,
        });

  return meta.packages.filter((p) => selectedRelPaths.includes(p.relPath));
}

/** Pick which staged packages to remove — nothing preselected (opt-in each). */
export async function selectStagedPackagesToRemove(
  meta: PackagesStoreMeta,
  prompt: PromptAdapter,
  /** GUI-page pre-collected relPaths: when set, skip the prompt entirely. */
  preselected?: string[],
): Promise<StagedPackage[]> {
  const selectedRelPaths = preselected
    ? preselected
    : await prompt.multiselect({
        message: "Select packages to remove from the library",
        options: meta.packages.map((p) => ({
          value: p.relPath,
          label: packageSelectLabel(p, meta.packages),
        })),
        initialValues: [],
        required: false,
      });

  return meta.packages.filter((p) => selectedRelPaths.includes(p.relPath));
}
