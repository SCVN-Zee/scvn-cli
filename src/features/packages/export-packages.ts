/**
 * features/packages/export-packages.ts — Add selected packages to the library.
 *
 * This is the "add" operation (surfaced as `scvn packages add`). It stages the
 * given packages from a source project INTO the store library, MERGING with
 * whatever is already staged — packages added earlier from other projects are
 * preserved. Re-adding a relPath re-copies its mirror and updates its entry.
 *
 * Takes the package already resolved by the caller (resolveAddFolder turns the
 * picked folder into { projectRoot, relPath, label }). Nothing is re-validated
 * here: resolveAddFolder already rejected unsafe paths. importPackages does
 * re-check, because ITS input is meta.json — on-disk state possibly written by
 * an older scvn. The asymmetry is deliberate.
 *
 * Steps:
 *   1. confirm() with per-package sizes — decline → skipped/Aborted (no writes)
 *   2. Persist the selection (only on proceed — v0.1 parity)
 *   3. Copy each package + sidecar into the store mirror
 *   4. Upsert the staged entries (with per-package provenance) into the library
 *      meta — merged with existing entries, NOT overwriting them. Skipped on
 *      dry-run.
 */

import path from "node:path";
import { duSize, formatBytes } from "../../util/du-size.js";
import { shortenPath, deriveProjectName } from "../../util/paths.js";
import type { PackageSpec } from "./resolve-add-folder.js";
import type { SyncReporter, SyncConfirm } from "../transfer/reporter.js";
import { noopReporter, autoConfirm } from "../transfer/reporter.js";
import { getRepoInfo } from "../../services/git.js";
import { getPackagesStoreDir } from "../store/store-paths.js";
import { upsertPackagesStoreMeta } from "../store/store-meta.js";
import type { StagedPackage } from "../store/store-meta.js";
import { copyPackage } from "./copy-package.js";

export interface ExportPackagesOpts {
  dryRun?:   boolean;
  reporter?: SyncReporter;
  confirm?:  SyncConfirm;
  /** Store-root override (tests) */
  storeDir?: string;
}

/**
 * Stage the given package(s) from src (the project root) into the store library.
 * The package is resolved by the caller (resolveAddFolder) from the picked
 * folder; src + relPath locate the folder to mirror.
 */
export async function exportPackages(
  src: string,
  selected: PackageSpec[],
  opts: ExportPackagesOpts = {},
): Promise<void> {
  const reporter = opts.reporter ?? noopReporter;
  const confirm  = opts.confirm  ?? autoConfirm;
  const dryRun   = opts.dryRun   ?? false;
  const storeDir = getPackagesStoreDir(opts.storeDir);

  if (selected.length === 0) {
    reporter.onStatus({ status: "skipped", detail: "Nothing selected" });
    return;
  }

  // Per-package sizes for the confirm preview + meta
  const sized = await Promise.all(
    selected.map(async (e) => ({
      label:   e.label,
      relPath: e.relPath,
      bytes:   await duSize(path.join(src, e.relPath)).catch(() => 0),
    }))
  );
  const totalBytes = sized.reduce((sum, p) => sum + p.bytes, 0);

  const ok = await confirm({
    title: `Add ${selected.length} package(s) to the library`,
    body: [
      `source: ${shortenPath(src)}`,
      `store:  ${shortenPath(storeDir)}`,
      ...sized.map((p) => `  ${p.label}  ${formatBytes(p.bytes)}`),
    ].join("\n"),
  });
  if (!ok) {
    reporter.onStatus({ status: "skipped", detail: "Aborted" });
    return;
  }

  reporter.onStatus({ status: "running" });
  let copied = 0;

  for (const entry of selected) {
    reporter.onStatus({ status: "running", detail: `Staging ${entry.label}…` });
    try {
      await copyPackage(src, storeDir, entry.relPath, dryRun, (progress) => {
        reporter.onProgress(progress);
      });
      copied++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reporter.onStatus({ status: "failed", error: `${entry.label}: ${message}` });
      throw err;
    }
  }

  if (!dryRun) {
    // One provenance stamp for this add-run; each package inherits it. Merged
    // into the library (upsert) so packages added earlier are preserved.
    const { branch } = await getRepoInfo(src).catch(() => ({ root: null, branch: null }));
    const sourceName = deriveProjectName(src);
    const stagedAt   = new Date().toISOString();
    const staged: StagedPackage[] = sized.map((p) => ({
      ...p,
      sourcePath: src,
      sourceName,
      branch,
      stagedAt,
    }));
    await upsertPackagesStoreMeta(staged, opts.storeDir);
  }

  reporter.onStatus({ status: "done", detail: `${copied} package(s) added (${formatBytes(totalBytes)})` });
}
