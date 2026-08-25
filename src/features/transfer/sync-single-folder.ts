/**
 * features/transfer/sync-single-folder.ts — Shared rsync helper.
 *
 * syncSingleFolder(src, target, rel, opts)
 *   1. mkdir -p parent of target/rel
 *   2. rsyncCopyStream src/rel/ → target/rel/ (deleteAfter + optional progress)
 *   3. rsyncCopy src/rel.meta → target/rel.meta if .meta exists
 *
 * Ported from sync-unity wholesale with import paths adjusted for scvn.
 */

import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { rsyncCopyStream, rsyncCopy } from "../../services/rsync.js";
import type { RsyncProgress } from "../../services/rsync.js";

export interface SyncSingleFolderOpts {
  dryRun?: boolean;
  onProgress?: (progress: RsyncProgress) => void;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rsync a single named folder from src/rel to target/rel (trailing-slash mirror semantics).
 * Creates parent dir if needed; copies paired .meta sidecar if present.
 */
export async function syncSingleFolder(
  src: string,
  target: string,
  rel: string,
  opts: SyncSingleFolderOpts = {}
): Promise<void> {
  const sourcePath = path.join(src, rel);
  const targetPath = path.join(target, rel);
  const parent = path.dirname(targetPath);

  if (!opts.dryRun) {
    await mkdir(parent, { recursive: true });
  }

  for await (const event of rsyncCopyStream(sourcePath + "/", targetPath + "/", {
    dryRun: opts.dryRun,
    deleteAfter: true,
    progress: Boolean(opts.onProgress),
  })) {
    if ("percentage" in event && opts.onProgress) {
      opts.onProgress(event);
    }
  }

  // Paired .meta copy (Unity GUID sidecar)
  const metaSource = sourcePath + ".meta";
  const metaTarget = targetPath + ".meta";
  if (await pathExists(metaSource)) {
    await rsyncCopy(metaSource, metaTarget, { dryRun: opts.dryRun });
  }
}
