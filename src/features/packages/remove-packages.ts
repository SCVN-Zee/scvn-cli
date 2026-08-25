/**
 * features/packages/remove-packages.ts — Remove packages from the library.
 *
 * The counterpart to add: drop one or more staged packages from the store. For
 * each named label we delete its mirror dir + paired .meta sidecar under the
 * store, then drop its entry from meta.json. Labels not present are skipped with
 * a warning (never a throw). Nothing else in the library is touched.
 *
 * relPaths come from meta.json — on-disk state possibly written by an older
 * scvn — so each is re-checked with isSafeRelPath before any recursive delete,
 * exactly like importPackages does.
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import { formatBytes } from "../../util/du-size.js";
import { isSafeRelPath } from "../../lib/rel-path-safety.js";
import type { SyncReporter, SyncConfirm } from "../transfer/reporter.js";
import { noopReporter, autoConfirm } from "../transfer/reporter.js";
import { getPackagesStoreDir } from "../store/store-paths.js";
import { readPackagesStoreMeta, removePackagesStoreEntries } from "../store/store-meta.js";
import type { StagedPackage } from "../store/store-meta.js";

export interface RemovePackagesOpts {
  dryRun?:   boolean;
  reporter?: SyncReporter;
  confirm?:  SyncConfirm;
  /** Store-root override (tests) */
  storeDir?: string;
}

/**
 * Remove the named packages from the library (mirror + sidecar + meta entry).
 * Returns without writes when nothing matches or the confirm is declined.
 */
export async function removePackages(
  labels: string[],
  opts: RemovePackagesOpts = {},
): Promise<void> {
  const reporter = opts.reporter ?? noopReporter;
  const confirm  = opts.confirm  ?? autoConfirm;
  const dryRun   = opts.dryRun   ?? false;
  const storeDir = getPackagesStoreDir(opts.storeDir);

  if (labels.length === 0) {
    reporter.onStatus({ status: "skipped", detail: "Nothing selected" });
    return;
  }

  const meta = await readPackagesStoreMeta(opts.storeDir);
  if (!meta || meta.packages.length === 0) {
    reporter.onStatus({ status: "skipped", detail: "Nothing staged" });
    return;
  }

  const wanted: Record<string, true> = {};
  for (const label of labels) wanted[label] = true;
  const targets: StagedPackage[] = meta.packages.filter((p) => wanted[p.label] === true);

  const missing = labels.filter((l) => !meta.packages.some((p) => p.label === l));
  for (const label of missing) {
    reporter.onLog({ ts: Date.now(), level: "warn", message: `Not staged: ${label} (skipped)` });
  }

  if (targets.length === 0) {
    reporter.onStatus({ status: "skipped", detail: "No matching packages staged" });
    return;
  }

  const freedBytes = targets.reduce((sum, p) => sum + p.bytes, 0);
  const ok = await confirm({
    title: `Remove ${targets.length} package(s) from the library`,
    body: targets.map((p) => `  ${p.label}  ${formatBytes(p.bytes)}`).join("\n"),
  });
  if (!ok) {
    reporter.onStatus({ status: "skipped", detail: "Aborted" });
    return;
  }

  reporter.onStatus({ status: "running" });

  const removedLabels: string[] = [];
  for (const pkg of targets) {
    if (!isSafeRelPath(pkg.relPath)) {
      // Never recursively delete an unsafe path from meta; leave the entry too.
      reporter.onLog({
        ts: Date.now(),
        level: "error",
        message: `Unsafe path in store meta: ${pkg.label} (${pkg.relPath}) — left in place`,
      });
      continue;
    }
    reporter.onStatus({ status: "running", detail: `Removing ${pkg.label}…` });
    if (!dryRun) {
      const mirror = path.join(storeDir, pkg.relPath);
      await rm(mirror, { recursive: true, force: true });
      await rm(`${mirror}.meta`, { force: true });
    }
    removedLabels.push(pkg.label);
  }

  if (!dryRun && removedLabels.length > 0) {
    await removePackagesStoreEntries(removedLabels, opts.storeDir);
  }

  reporter.onStatus({
    status: "done",
    detail: `${removedLabels.length} package(s) removed (${formatBytes(freedBytes)} freed)`,
  });
}
