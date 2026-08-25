/**
 * commands/shared/select-packages.ts — Staged-package selection prompts.
 *
 * selectStagedPackages — which staged packages to apply on import. Reads
 *   meta.packages (never a catalog): meta.json is the apply-truth at import time.
 * selectStagedPackagesToRemove — which staged packages to drop from the library
 *   (nothing preselected — the user opts each one in).
 */

import type { PromptAdapter } from "../../ui/prompt.js";
import type { PackagesStoreMeta, StagedPackage } from "../../features/store/store-meta.js";

/** Pick which staged packages to apply — default ALL staged. */
export async function selectStagedPackages(
  meta: PackagesStoreMeta,
  autoYes: boolean,
  prompt: PromptAdapter,
  /** GUI-page pre-collected labels: when set, skip the prompt entirely. */
  preselected?: string[],
): Promise<StagedPackage[]> {
  const allLabels = meta.packages.map((p) => p.label);

  const selectedLabels = preselected
    ? preselected
    : autoYes
      ? allLabels
      : await prompt.multiselect({
          message: "Select staged packages to import",
          options: meta.packages.map((p) => ({ value: p.label, label: p.label })),
          initialValues: allLabels,
          required: false,
        });

  return meta.packages.filter((p) => selectedLabels.includes(p.label));
}

/** Pick which staged packages to remove — nothing preselected (opt-in each). */
export async function selectStagedPackagesToRemove(
  meta: PackagesStoreMeta,
  prompt: PromptAdapter,
  /** GUI-page pre-collected labels: when set, skip the prompt entirely. */
  preselected?: string[],
): Promise<StagedPackage[]> {
  const selectedLabels = preselected
    ? preselected
    : await prompt.multiselect({
        message: "Select packages to remove from the library",
        options: meta.packages.map((p) => ({ value: p.label, label: p.label })),
        initialValues: [],
        required: false,
      });

  return meta.packages.filter((p) => selectedLabels.includes(p.label));
}
