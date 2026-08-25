/**
 * features/packages/import-packages.ts — Apply staged packages to ONE target.
 *
 * The command layer owns target selection, the summary confirm, and the
 * multi-target loop. This handler copies each staged package (+ sidecar)
 * from the store mirror into the target, then offers dangling-.meta cleanup.
 *
 * Cleanup deviation from v0.1 (deliberate): the old check compared target
 * .meta files against the FULL source project; the store is a PARTIAL mirror
 * (only staged packages), so that comparison would flag innocent metas.
 * Instead we remove only metas that are dangling in the target ITSELF —
 * target/X.meta with no target/X — which is safe regardless of store contents.
 */

import { rm, readdir } from "node:fs/promises";
import path from "node:path";
import { shortenPath } from "../../util/paths.js";
import { isSafeRelPath } from "../../lib/rel-path-safety.js";
import { exists } from "../../util/fs-predicates.js";
import type { SyncReporter, SyncConfirm } from "../transfer/reporter.js";
import { noopReporter, autoConfirm } from "../transfer/reporter.js";
import { getPackagesStoreDir } from "../store/store-paths.js";
import type { StagedPackage } from "../store/store-meta.js";
import { copyPackage } from "./copy-package.js";

/**
 * Find .meta files in target whose counterpart is missing in target itself
 * (true dangling sidecars). Top-level scan, matching the v0.1 cleanup scope.
 */
async function findDanglingMetas(target: string): Promise<string[]> {
  const dangling: string[] = [];
  try {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".meta")) continue;
      const base = entry.name.slice(0, -5); // strip .meta
      if (!(await exists(path.join(target, base)))) {
        dangling.push(path.join(target, entry.name));
      }
    }
  } catch {
    // target not readable — nothing to clean
  }
  return dangling;
}

export interface ImportPackagesOpts {
  dryRun?:   boolean;
  reporter?: SyncReporter;
  confirm?:  SyncConfirm;
  /** Store-root override (tests) */
  storeDir?: string;
}

/**
 * Apply the given staged packages (from meta.packages, possibly a subset)
 * into the target project, then offer dangling-.meta cleanup (decline →
 * skip silently; cleanup failure never aborts the import — v0.1 parity).
 */
export async function importPackages(
  target: string,
  staged: StagedPackage[],
  opts: ImportPackagesOpts = {},
): Promise<void> {
  const reporter = opts.reporter ?? noopReporter;
  const confirm  = opts.confirm  ?? autoConfirm;
  const dryRun   = opts.dryRun   ?? false;
  const storeDir = getPackagesStoreDir(opts.storeDir);

  if (staged.length === 0) {
    reporter.onStatus({ status: "skipped", detail: "Nothing selected" });
    return;
  }

  // Defense in depth: relPaths must stay inside the slot, and the slot must
  // actually hold every requested package
  for (const pkg of staged) {
    if (!isSafeRelPath(pkg.relPath)) {
      reporter.onStatus({
        status: "failed",
        error: `Unsafe path in store meta: ${pkg.label} (${pkg.relPath}) — re-run \`scvn packages export\``,
      });
      return;
    }
    if (!(await exists(path.join(storeDir, pkg.relPath)))) {
      reporter.onStatus({
        status: "failed",
        error: `Not staged: ${pkg.label} — run \`scvn packages export\` first`,
      });
      return;
    }
  }

  reporter.onStatus({ status: "running" });
  let copied = 0;

  for (const pkg of staged) {
    reporter.onStatus({ status: "running", detail: `Applying ${pkg.label}…` });
    try {
      await copyPackage(storeDir, target, pkg.relPath, dryRun, (progress) => {
        reporter.onProgress(progress);
      });
      copied++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reporter.onStatus({ status: "failed", error: `${pkg.label}: ${message}` });
      throw err;
    }
  }

  reporter.onStatus({ status: "done", detail: `${copied} package(s) applied` });

  // Optional sub-step: dangling-.meta cleanup (decline → skip silently)
  try {
    const dangling = await findDanglingMetas(target);
    if (dangling.length > 0) {
      const cleanupOk = await confirm({
        title: "Remove dangling .meta files in target?",
        body: `${dangling.length} .meta file(s) without a matching asset in ${shortenPath(target)}`,
      });
      if (cleanupOk && !dryRun) {
        await Promise.all(dangling.map((p) => rm(p, { force: true })));
        reporter.onStatus({
          status: "done",
          detail: `${copied} package(s) applied; ${dangling.length} dangling .meta(s) removed`,
        });
      }
    }
  } catch {
    // Cleanup failure never aborts the import
  }
}
