/**
 * writers/write-gitattributes.ts — Write Unity smart-merge .gitattributes block.
 *
 * The block body is sourced from the bundled `templates/gitattributes-merge`
 * template (single source of truth), inserted as a marker block (BEGIN/END
 * fork-unity-setup) for idempotent, safe updates — foreign lines and the
 * coexisting LFS block (a different marker pair) are preserved. Backs up each
 * .gitattributes before modification. Atomic write via tmp+rename.
 */

import fs from "fs/promises";
import path from "path";
import { backupFile } from "../lib/backup.js";
import { replaceMarkerBlock } from "../lib/markers.js";
import { resolveTemplateKey } from "../util/template-paths.js";

export interface GitAttrsInput {
  projectPaths: string[];
}

export interface GitAttrsPerProject {
  path: string;
  backupPath: string;
  written: boolean;
}

export interface GitAttrsResult {
  perProject: GitAttrsPerProject[];
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.fork-unity-setup.tmp-${process.pid}`;
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
 * Load the smart-merge block body from the bundled template. Trailing newlines
 * are stripped so the inserted marker block does not open a blank line before
 * its closing END marker (same guard as setup-gitexclude).
 */
export async function loadUnityGitAttributesBlock(): Promise<string> {
  const templatePath = await resolveTemplateKey("gitattributesMerge");
  return (await fs.readFile(templatePath, "utf8")).replace(/\n+$/, "");
}

export async function writeGitAttributes(
  input: GitAttrsInput,
): Promise<GitAttrsResult> {
  // Read the template once; reuse the same block for every selected project.
  const block = await loadUnityGitAttributesBlock();
  const perProject: GitAttrsPerProject[] = [];
  for (const projectPath of input.projectPaths) {
    const file = path.join(projectPath, ".gitattributes");
    const current = await readIfExists(file);
    const backupPath = await backupFile(file);
    const next = replaceMarkerBlock(current, block);
    if (next !== current) {
      await atomicWrite(file, next);
    }
    perProject.push({ path: file, backupPath, written: next !== current });
  }
  return { perProject };
}
