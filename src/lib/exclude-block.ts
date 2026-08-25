/**
 * lib/exclude-block.ts — Fenced read/modify/write of a `.git/info/exclude` file.
 *
 * `info/exclude` is shared ground: scvn's template block, the vendored-MCP
 * block, and whatever the developer hand-wrote all live in one file. Copying a
 * template over it wholesale destroys the other two. Every write here goes
 * through a marker fence, so each owner refreshes only its own block.
 *
 * The fences mirror the `>>> / <<<` convention of the bash script this replaced,
 * which lets P3 recognize and migrate the block that script left behind.
 *
 * Writes are atomic (tmp + rename) and skipped when the content is unchanged.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { replaceMarkerBlock, stripMarkerBlock } from "./markers.js";
import type { MarkerPair } from "./markers.js";

/** scvn's own template block (`scvn git --exclude`). */
export const SCVN_FENCE: MarkerPair = {
  begin: "# >>> scvn >>>",
  end: "# <<< scvn <<<",
};

/** The vendored Unity-MCP sources block (`scvn mcp install`). */
export const SCVN_MCP_FENCE: MarkerPair = {
  begin: "# >>> scvn mcp >>>",
  end: "# <<< scvn mcp <<<",
};

/** The block written by the retired `unity-mcp-localize.sh`; stripped on migration. */
export const LEGACY_MCP_FENCE: MarkerPair = {
  begin: "# >>> unity-mcp-localize >>>",
  end: "# <<< unity-mcp-localize <<<",
};

export interface ExcludeBlockResult {
  path: string;
  /** False when the file already held the desired bytes — nothing was touched. */
  written: boolean;
}

export interface ApplyExcludeBlockOpts {
  /**
   * Text to fence into, replacing the file's current content. Pass `""` to
   * discard a file proven to be entirely scvn-owned (the byte-equal migration
   * from the pre-fence template). Omit it to preserve foreign content.
   */
  baseText?: string;
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tempPath = `${file}.scvn.tmp-${process.pid}`;
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, file);
}

/**
 * Insert or refresh `fence` around `inner` in the exclude file at `file`.
 * Foreign lines and foreign fences survive byte-identical. Throws when the
 * file holds an unbalanced copy of `fence` (crash residue) rather than
 * guessing which bytes to delete.
 */
export async function applyExcludeBlock(
  file: string,
  inner: string,
  fence: MarkerPair,
  opts: ApplyExcludeBlockOpts = {},
): Promise<ExcludeBlockResult> {
  const current = await readIfExists(file);
  const next = replaceMarkerBlock(opts.baseText ?? current, inner, fence);
  const written = next !== current;
  if (written) {
    await atomicWrite(file, next);
  }
  return { path: file, written };
}

/**
 * Remove `fence` and its body from the exclude file. Absent fence, or a file
 * that does not exist, is a no-op — never creates the file.
 */
export async function stripExcludeBlock(
  file: string,
  fence: MarkerPair,
): Promise<ExcludeBlockResult> {
  const current = await readIfExists(file);
  const next = stripMarkerBlock(current, fence);
  const written = next !== current;
  if (written) {
    await atomicWrite(file, next);
  }
  return { path: file, written };
}
