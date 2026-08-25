/**
 * services/zip.ts — Create a zip archive by shelling out to `zip` via execa.
 *
 * Mirrors the rsync/git service pattern (no new npm dep). Archiving from the staging dir as cwd
 * with a literal `.` keeps in-archive paths relative (`bin/…`, `dist/…`, `store/…`, `node/…`) —
 * no absolute-path leakage. macOS and Linux both ship `zip`; a missing binary surfaces as a
 * thrown execa error.
 *
 * Atomic publish: the archive is built into a sibling `<archive>.tmp.<pid>` and renamed onto the
 * final path only after `zip` succeeds, so a killed or failed run never leaves a partial archive
 * at `archivePath` (and a concurrent same-version pack won't read a half-written file).
 */

import { execa } from "execa";
import { rm, rename } from "node:fs/promises";

/**
 * Zip the CONTENTS of `stagingDir` into `archivePath` (an absolute path outside `stagingDir`).
 * Throws on a non-zero `zip` exit, leaving no partial archive behind.
 */
export async function createZip(stagingDir: string, archivePath: string): Promise<void> {
  const tmp = `${archivePath}.tmp.${process.pid}`;
  await rm(tmp, { force: true });
  await rm(archivePath, { force: true }); // `zip` updates in place; remove any stale archive first
  try {
    await execa("zip", ["-r", "-q", tmp, "."], { cwd: stagingDir });
    await rename(tmp, archivePath);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
