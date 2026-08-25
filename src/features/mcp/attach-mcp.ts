/**
 * features/mcp/attach-mcp.ts — Reconcile a project's vendored source to a package set.
 *
 * The shared mutating path behind both `install` and `update`. Ordering is
 * load-bearing, and it is the same order the bash original arrived at:
 *
 *   1. editor gate      — importing must not race Unity's asset importer
 *   2. cache assert     — every wanted package is actually staged
 *   3. pin gate         — no addon skewed against this core
 *   4. exclude fence    — BEFORE the import, so the vendored source is never
 *                         even briefly visible to git (a first install would
 *                         otherwise dump thousands of untracked files)
 *   5. rsync + reconcile — refresh what is wanted, drop what is not
 *   6. marker           — the lockfile the next update reads
 *   7. porcelain gate   — prove the UPM machinery files never moved
 *
 * Everything that can FAIL is ordered before the first write to the project.
 *
 * Ports `cmd_attach` (unity-mcp-localize.sh:728), minus `migrate_legacy` — that
 * restored 3 files via `git checkout` and had zero live subjects. Dropping it
 * removes the only git WRITE from the tool; the porcelain gate remains as the
 * safety net that would have caught what it was cleaning up.
 */

import path from "node:path";
import { access, mkdir } from "node:fs/promises";
import { rsyncCopy } from "../../services/rsync.js";
import { detectUnityRunning } from "../../detectors/detect-unity-running.js";
import {
  applyExcludeBlock,
  stripExcludeBlock,
  SCVN_MCP_FENCE,
  LEGACY_MCP_FENCE,
} from "../../lib/exclude-block.js";
import { getGitInfoExcludePath } from "../../services/git.js";
import { WIRE_SUBDIR, NUGET_SUBDIR, MCP_JSON } from "./mcp-constants.js";
import { pinGate } from "./pin-gate.js";
import { porcelainGate } from "./porcelain-gate.js";
import { reconcileImportRoot } from "./reconcile-import-root.js";
import { importRoot, writeMarker } from "./marker.js";
import { readVersionsJson } from "./versions-json.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface AttachOpts {
  /** Enclosing git repo root, or null when the project is not in a repo. */
  repoRoot: string | null;
  /** The Unity project dir (parent of Assets/). */
  unityProjectDir: string;
  /** The staged version dir to import FROM. */
  verDirPath: string;
  coreVersion: string;
  /** Exact package set to end up with — never empty. */
  want: readonly string[];
  force?: boolean;
  dryRun?: boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

function log(opts: AttachOpts, level: "info" | "warn", message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

/**
 * The git-exclude patterns for everything an install leaves on disk, anchored at
 * the repo root (leading `/`) so they never depend on core.ignorecase.
 *
 * `.mcp.json` is in here because the install CREATES it (via unity-mcp-cli).
 * Every artifact this command produces is a local one, so every artifact it
 * produces is one it has to keep out of git — otherwise "nothing to commit"
 * quietly becomes "one untracked file to explain".
 */
export function excludeLines(repoRoot: string, unityProjectDir: string): string {
  const rel = path.relative(repoRoot, unityProjectDir);
  const prefix = rel ? `${rel}/` : "";
  return [
    `/${prefix}${WIRE_SUBDIR}/`,
    `/${prefix}${WIRE_SUBDIR}.meta`,
    `/${prefix}${NUGET_SUBDIR}/`,
    `/${prefix}${NUGET_SUBDIR}.meta`,
    `/${prefix}${MCP_JSON}`,
  ].join("\n");
}

async function assertStaged(opts: AttachOpts): Promise<void> {
  for (const pkg of opts.want) {
    try {
      await access(path.join(opts.verDirPath, pkg));
    } catch {
      throw new Error(
        `staged V${opts.coreVersion} lacks package folder: ${pkg}\n` +
          `  re-run install with --addons; it re-stages the version automatically`,
      );
    }
  }
}

/** Own the exclude fence before importing, and clear the retired script's fence. */
async function writeFence(opts: AttachOpts): Promise<void> {
  if (opts.repoRoot === null) {
    log(opts, "warn", "not a git repo — skipping the .git/info/exclude fence");
    return;
  }

  const excludePath = await getGitInfoExcludePath(opts.repoRoot);
  if (excludePath === null) return;

  if (opts.dryRun) {
    log(opts, "info", `[dry-run] would fence the vendored source in ${excludePath}`);
    return;
  }

  // A repo wired by the retired bash script carries its fence; drop it, so the
  // same patterns are not listed twice under two different owners.
  await stripExcludeBlock(excludePath, LEGACY_MCP_FENCE);
  await applyExcludeBlock(
    excludePath,
    excludeLines(opts.repoRoot, opts.unityProjectDir),
    SCVN_MCP_FENCE,
  );
  log(opts, "info", "vendored source fenced in .git/info/exclude — nothing to commit");
}

/** Reconcile the project's vendored source to exactly `want`. */
export async function attachMcp(opts: AttachOpts): Promise<void> {
  if (opts.want.length === 0) {
    throw new Error(`attachMcp: empty package set for ${opts.unityProjectDir}`);
  }

  // 1. Editor gate. A dry run mutates nothing, so it previews regardless.
  if (await detectUnityRunning(opts.unityProjectDir)) {
    if (opts.dryRun) {
      log(opts, "warn", "Unity appears to be running — a real run would require it closed (or --force)");
    } else if (opts.force) {
      log(opts, "warn", "Unity is running but --force was given — proceeding (risky)");
    } else {
      throw new Error(
        `Unity appears to be running on this project — close it first (or --force).\n` +
          `  The source import must not race the editor's asset importer.`,
      );
    }
  }

  // 2-3. Everything that can fail, before the first write.
  await assertStaged(opts);
  await pinGate(opts.verDirPath, opts.coreVersion, opts.want, {
    force: opts.force,
    reporter: opts.reporter,
  });

  // 4. Fence first — the import must never be briefly visible to git.
  await writeFence(opts);

  // 5. Import + reconcile.
  const dest = importRoot(opts.unityProjectDir);
  if (!opts.dryRun) await mkdir(dest, { recursive: true });

  for (const pkg of opts.want) {
    opts.reporter?.onStatus({ status: "running", detail: `importing ${pkg}` });
    // Trailing slashes mirror CONTENTS (rsync -a --delete-after), so Unity
    // reimports only the delta rather than the whole tree.
    await rsyncCopy(
      `${path.join(opts.verDirPath, pkg)}/`,
      `${path.join(dest, pkg)}/`,
      { dryRun: opts.dryRun },
    );
  }
  await reconcileImportRoot(dest, opts.want, { dryRun: opts.dryRun, reporter: opts.reporter });

  // 6. Marker — records exactly what was installed; the next update reads it.
  if (opts.dryRun) {
    log(opts, "info", `[dry-run] would import ${opts.want.length} packages → ${dest}`);
    return;
  }

  const staged = await readVersionsJson(opts.verDirPath);
  await writeMarker(opts.unityProjectDir, {
    coreVersion: opts.coreVersion,
    packages: Object.fromEntries(opts.want.map((pkg) => [pkg, staged.packages[pkg] ?? "?"])),
    source: opts.verDirPath,
    importedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  log(opts, "info", `imported ${opts.want.length} packages → ${dest}`);

  // 7. Read-only proof that vendoring left UPM alone.
  if (opts.repoRoot !== null) {
    await porcelainGate(opts.repoRoot, opts.unityProjectDir);
  }
}
