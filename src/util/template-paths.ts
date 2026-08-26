/**
 * util/template-paths.ts — Locate the tool's bundled templates/ directory.
 *
 * Templates live at: <install-root>/templates/. The up-walk that locates the
 * install root is shared with the bundled-store probe (see util/install-root.ts);
 * this module just joins `templates/` onto that root and caches the result.
 *
 * Ported from sync-unity. Error message updated to reference scvn.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getTemplatesOverrideDir } from "../config/paths.js";
import { findInstallRoot } from "./install-root.js";

export type TemplateKey =
  | "gitignore"
  | "gitexclude"
  | "gitattributesMerge"
  | "gitattributesLfs";

// ---------------------------------------------------------------------------
// Key → filename (parity with bash _template_source_filename)
// ---------------------------------------------------------------------------

const FILENAME_MAP: Record<TemplateKey, string> = {
  gitignore:          ".gitignore",
  gitexclude:         "git-exclude",
  // Block-source (read into the fork marker block), not a whole-file copy — the
  // filename carries no leading dot, matching git-exclude.
  gitattributesMerge: "gitattributes-merge",
  // Block-source for the Git-LFS marker block; extracted from the former inline
  // constant so it flows through the same override layer as the other artifacts.
  gitattributesLfs:   "gitattributes-lfs",
};

export function templateFilename(key: TemplateKey): string {
  return FILENAME_MAP[key];
}

// ---------------------------------------------------------------------------
// Key → bundled source filename
// ---------------------------------------------------------------------------

// The filename of the read-only default artifact inside the bundled templates/
// dir. This is deliberately NOT the same as templateFilename() for `gitignore`:
// electron-builder's default file filter strips any packaged file named
// `.gitignore` (and `.gitkeep`), so the desktop app would ship without the
// bundled default. Storing it as `gitignore` (no leading dot, matching the
// git-exclude / gitattributes-* artifacts) survives packaging. The output
// written into a user's project is still `.gitignore` (see setup-templates
// resolveTargetPath), and the editor still displays templateFilename().
const SOURCE_FILENAME_MAP: Record<TemplateKey, string> = {
  ...FILENAME_MAP,
  gitignore: "gitignore",
};

/** Filename of the bundled default artifact for `key` inside templates/. */
export function templateSourceFilename(key: TemplateKey): string {
  return SOURCE_FILENAME_MAP[key];
}

// ---------------------------------------------------------------------------
// Walk up from module location to find templates/ directory
// ---------------------------------------------------------------------------

let _templatesDir: string | null = null;

async function findTemplatesDir(): Promise<string> {
  if (_templatesDir !== null) return _templatesDir;

  const root = await findInstallRoot();
  if (root === null) {
    throw new Error("scvn: could not locate templates/ directory");
  }
  _templatesDir = path.join(root, "templates");
  return _templatesDir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve an absolute path to a file inside the bundled templates/ directory. */
export async function resolveTemplatePath(filename: string): Promise<string> {
  const dir = await findTemplatesDir();
  return path.join(dir, filename);
}

/**
 * Convenience: resolve a template by its TemplateKey. A writable user override
 * at ~/.scvn/templates/<filename> is preferred over the bundled default, so the
 * desktop editor and the CLI share one effective template. The override dir is
 * probed every call (never cached) — the editor can create/remove it mid-session
 * and the next read must observe that immediately.
 */
export async function resolveTemplateKey(
  key: TemplateKey,
  overrideRoot?: string,
): Promise<string> {
  const overridePath = path.join(getTemplatesOverrideDir(overrideRoot), templateFilename(key));
  try {
    await fs.access(overridePath);
    return overridePath;
  } catch {
    return resolveTemplatePath(templateSourceFilename(key));
  }
}

/** @internal Reset cached templates dir (for tests). */
export function _resetTemplatesDir(): void {
  _templatesDir = null;
}
