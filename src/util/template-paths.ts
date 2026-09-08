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
import { randomUUID } from "node:crypto";
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

export interface TemplatePresets {
  selectedPreset: string;
  presets: { id: string; name: string }[];
}

export function templatePresetsDir(key: TemplateKey, overrideRoot?: string): string {
  return path.join(getTemplatesOverrideDir(overrideRoot), "presets", key);
}

/** Writable paths accept only generated custom IDs, never Default or user names. */
export function templatePresetPath(key: TemplateKey, preset: string, overrideRoot?: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(preset)) {
    throw new Error("templates: invalid preset ID");
  }
  return path.join(templatePresetsDir(key, overrideRoot), preset);
}

/** Atomic writes shared by catalog migration and the desktop editor. */
export async function writeTemplateFile(dest: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const temp = `${dest}.scvn-tmpl.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temp, content, "utf8");
    await fs.rename(temp, dest);
  } finally {
    await fs.unlink(temp).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
}

export async function saveTemplatePresets(key: TemplateKey, state: TemplatePresets, overrideRoot?: string): Promise<void> {
  await writeTemplateFile(path.join(templatePresetsDir(key, overrideRoot), "index.json"), JSON.stringify({ ...state, version: 2 }, null, 2) + "\n");
}

// ponytail: serialize in-process migration; use a file lock if multiple catalog writers are supported.
let readingPresets: Promise<unknown> = Promise.resolve();
export function readTemplatePresets(key: TemplateKey, overrideRoot?: string): Promise<TemplatePresets> {
  const next = readingPresets.then(() => loadTemplatePresets(key, overrideRoot));
  readingPresets = next.catch(() => {});
  return next;
}

/** Fail closed on damaged metadata rather than silently applying the wrong template. */
async function loadTemplatePresets(key: TemplateKey, overrideRoot?: string): Promise<TemplatePresets> {
  let state: TemplatePresets & { version?: number };
  try {
    state = JSON.parse(await fs.readFile(path.join(templatePresetsDir(key, overrideRoot), "index.json"), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    state = { selectedPreset: "default", presets: [{ id: "default", name: "Default" }] };
  }
  if (!state || !Array.isArray(state.presets) || typeof state.selectedPreset !== "string" ||
      (state.version !== undefined && state.version !== 2)) {
    throw new Error("templates: invalid preset catalog");
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const preset of state.presets) {
    if (!preset || typeof preset.id !== "string" || typeof preset.name !== "string" ||
        !preset.name.trim() || preset.name !== preset.name.trim() || preset.name.length > 80 ||
        /[\x00-\x1f\x7f]/.test(preset.name) || ids.has(preset.id) || names.has(preset.name.toLowerCase())) {
      throw new Error("templates: invalid preset catalog");
    }
    if (preset.id !== "default") templatePresetPath(key, preset.id, overrideRoot);
    ids.add(preset.id);
    names.add(preset.name.toLowerCase());
  }
  if (!ids.has(state.selectedPreset) || !state.presets.some(p => p.id === "default" && p.name === "Default")) {
    throw new Error("templates: invalid preset catalog");
  }
  if (state.version !== 2) {
    let previous: string;
    try {
      previous = await fs.readFile(path.join(getTemplatesOverrideDir(overrideRoot), templateFilename(key)), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return state;
    }
    let name = "Previous Default";
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = "Previous Default " + suffix;
    const id = randomUUID();
    const dest = templatePresetPath(key, id, overrideRoot);
    await writeTemplateFile(dest, previous);
    state.presets.push({ id, name });
    if (state.selectedPreset === "default") state.selectedPreset = id;
    try {
      await saveTemplatePresets(key, state, overrideRoot);
    } catch (err) {
      await fs.unlink(dest);
      throw err;
    }
    // Leave the old file untouched as a backup. Version 2 prevents re-import after deletion.
  }
  return { selectedPreset: state.selectedPreset, presets: state.presets };
}

/** Default is always the bundled artifact; only named custom presets have writable files. */
export async function resolveTemplateKey(key: TemplateKey, overrideRoot?: string): Promise<string> {
  const { selectedPreset } = await readTemplatePresets(key, overrideRoot);
  return selectedPreset === "default"
    ? resolveTemplatePath(templateSourceFilename(key))
    : templatePresetPath(key, selectedPreset, overrideRoot);
}


/** @internal Reset cached templates dir (for tests). */
export function _resetTemplatesDir(): void {
  _templatesDir = null;
}
