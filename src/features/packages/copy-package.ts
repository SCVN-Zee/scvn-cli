/**
 * features/packages/copy-package.ts — Mirror one package dir + .meta sidecar.
 *
 * Shared by export (project → store) and import (store → project): clears the
 * destination slot, rsync-mirrors the package folder (deleteAfter), then
 * copies the paired Unity .meta sidecar if the source has one.
 */

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { rsyncCopyStream, rsyncCopy } from "../../services/rsync.js";
import type { RsyncProgress } from "../../services/rsync.js";
import { isFile } from "../../util/fs-predicates.js";

export async function copyPackage(
  fromRoot: string,
  toRoot: string,
  relPath: string,
  dryRun: boolean,
  onProgress: (progress: RsyncProgress) => void,
): Promise<void> {
  const sourceDirectory = path.join(fromRoot, relPath);
  const targetDirectory = path.join(toRoot, relPath);
  const sourceMeta      = path.join(fromRoot, `${relPath}.meta`);
  const targetMeta      = path.join(toRoot, `${relPath}.meta`);
  const parent          = path.dirname(targetDirectory);

  if (!dryRun) {
    await mkdir(parent, { recursive: true });
    await rm(targetDirectory, { recursive: true, force: true });
    await rm(targetMeta,      { force: true });
  }

  for await (const event of rsyncCopyStream(`${sourceDirectory}/`, `${targetDirectory}/`, {
    dryRun,
    deleteAfter: true,
    progress: true,
  })) {
    if ("percentage" in event) onProgress(event);
  }

  if (await isFile(sourceMeta)) {
    await rsyncCopy(sourceMeta, targetMeta, { dryRun });
  }
}
