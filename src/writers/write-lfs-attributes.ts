/**
 * writers/write-lfs-attributes.ts — Write the Git-LFS track block into a
 * repo-root `.gitattributes`.
 *
 * Uses its OWN marker pair (`# BEGIN/END scvn-lfs`), distinct from the fork
 * smart-merge block (`# BEGIN/END fork-unity-setup`), so both blocks coexist in
 * one file: LFS tracks BINARY assets (png/fbx/wav/…), smart-merge handles TEXT
 * Unity YAML (unity/prefab/asset/…) — disjoint file types, no conflict.
 *
 * Idempotent via markers.replaceMarkerBlock; backs up before mutation; atomic
 * write via tmp+rename; writes only when the block actually changed.
 */

import fs from "fs/promises";
import { backupFile } from "../lib/backup.js";
import { replaceMarkerBlock } from "../lib/markers.js";
import { resolveTemplateKey } from "../util/template-paths.js";

export const LFS_MARKER_BEGIN = "# BEGIN scvn-lfs";
export const LFS_MARKER_END = "# END scvn-lfs";

/**
 * Load the Unity binary-asset LFS block from the bundled template (or a user
 * override at <scvnDir>/templates/gitattributes-lfs). Trailing newlines are
 * stripped so the inserted marker block does not open a blank line before its
 * closing END marker — same guard as loadUnityGitAttributesBlock.
 *
 * `overrideRoot` (the scvn dir) is honored only for test isolation; production
 * passes nothing so the real `~/.scvn/templates/` override layer applies.
 */
export async function loadUnityLfsAttributesBlock(overrideRoot?: string): Promise<string> {
  const templatePath = await resolveTemplateKey("gitattributesLfs", overrideRoot);
  return (await fs.readFile(templatePath, "utf8")).replace(/\n+$/, "");
}

export interface LfsAttrsInput {
  /** Absolute path of the `.gitattributes` to write (repo root). */
  gitattributesPath: string;
  /** @internal scvn-dir override for the template read path (test isolation). */
  overrideRoot?: string;
}

export interface LfsAttrsResult {
  path: string;
  backupPath: string;
  written: boolean;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.scvn-lfs.tmp-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Write/refresh the LFS marker block in the given `.gitattributes`.
 * A pre-existing fork smart-merge block (different marker pair) is preserved.
 */
export async function writeLfsAttributes(
  input: LfsAttrsInput,
): Promise<LfsAttrsResult> {
  const file = input.gitattributesPath;
  const current = await readIfExists(file);
  const backupPath = await backupFile(file);
  const block = await loadUnityLfsAttributesBlock(input.overrideRoot);
  const next = replaceMarkerBlock(current, block, {
    begin: LFS_MARKER_BEGIN,
    end: LFS_MARKER_END,
  });
  if (next !== current) {
    await atomicWrite(file, next);
  }
  return { path: file, backupPath, written: next !== current };
}
