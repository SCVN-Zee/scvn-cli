/**
 * features/mcp/reconcile-import-root.ts — Drop vendored packages that are no longer wanted.
 *
 * rsync refreshes the packages it is GIVEN; it knows nothing about the ones it
 * isn't. Without this, dropping an addon would leave its source sitting in
 * Assets/UnityMCP forever, still compiling.
 *
 * Reconcile, not wipe. Two guards make that true:
 *
 *   1. An EMPTY wanted set is refused. With no names to keep, "remove everything
 *      not wanted" removes every package under the import root — a vendored-source
 *      wipe. Callers guard too; this is the last line of defense, so a future
 *      caller cannot silently turn this function into one.
 *
 *   2. Only DIRECTORIES are scanned. The marker file and the *.meta siblings can
 *      therefore never be swept by accident; a removed package's .meta is deleted
 *      explicitly, alongside its directory.
 *
 * Ports `reconcile_import_root` (unity-mcp-localize.sh:685).
 */

import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { SyncReporter } from "../transfer/reporter.js";

export interface ReconcileOpts {
  dryRun?: boolean;
  reporter?: Pick<SyncReporter, "onLog">;
}

/** Remove package dirs under `importRootDir` that are not in `wanted`. Returns what went. */
export async function reconcileImportRoot(
  importRootDir: string,
  wanted: readonly string[],
  opts: ReconcileOpts = {},
): Promise<string[]> {
  if (wanted.length === 0) {
    throw new Error(
      `reconcileImportRoot: refusing to run with an empty wanted set ` +
        `(that would delete every package under ${importRootDir})`,
    );
  }

  let entries;
  try {
    entries = await readdir(importRootDir, { withFileTypes: true });
  } catch {
    return []; // import root not created yet — nothing to reconcile
  }

  const orphans = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !wanted.includes(name));

  for (const orphan of orphans) {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "info",
      message: `${opts.dryRun ? "[dry-run] would remove" : "removing"} orphan package ${orphan}`,
    });
    if (opts.dryRun) continue;

    await rm(path.join(importRootDir, orphan), { recursive: true, force: true });
    // Unity writes the .meta on import, so it may not exist yet.
    await rm(path.join(importRootDir, `${orphan}.meta`), { force: true });
  }

  return orphans;
}
