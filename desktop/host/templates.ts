/**
 * desktop/host/templates.ts — Host handlers for the per-feature template editor.
 *
 * Three plain request/response commands (no session prompts, no streaming):
 *   templates:read  → TemplateContent          (effective + bundled default)
 *   templates:write → { isOverridden: true }   (atomic write to ~/.scvn/templates)
 *   templates:reset → { isOverridden: false }  (remove the override file)
 *
 * Writes are restricted to the EDITABLE_TEMPLATE_KEYS set — any other key is
 * rejected. Each filename is derived from templateFilename(key) (the CLI's
 * FILENAME_MAP), the single source of truth. Reads/writes go through the same
 * resolveTemplateKey / getTemplatesOverrideDir seams the CLI uses, so a GUI edit
 * is honored by a subsequent `scvn git` run with no restart (probe is uncached).
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getTemplatesOverrideDir } from "../../src/config/paths.js";
import {
  resolveTemplateKey,
  resolveTemplatePath,
  templateFilename,
  templateSourceFilename,
} from "../../src/util/template-paths.js";
import {
  EDITABLE_TEMPLATE_KEYS,
  type EditableTemplateKey,
  type TemplateContent,
} from "../shared/commands.js";

/** Validate the `key` arg is one of the editable templates. */
function requireEditableKey(args: unknown): EditableTemplateKey {
  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const key = record["key"];
  if (typeof key !== "string" || !EDITABLE_TEMPLATE_KEYS.some((k) => k === key)) {
    throw new Error(`templates: not an editable template key: ${String(key)}`);
  }
  return key as EditableTemplateKey;
}

/** True when ~/.scvn/templates/<key's filename> exists (a user override is present). */
async function hasOverride(key: EditableTemplateKey): Promise<boolean> {
  try {
    await readFile(path.join(getTemplatesOverrideDir(), templateFilename(key)));
    return true;
  } catch {
    return false;
  }
}

export async function templatesRead(_session: unknown, args: unknown): Promise<TemplateContent> {
  const key = requireEditableKey(args);
  const filename = templateFilename(key);
  const [effectivePath, defaultPath] = await Promise.all([
    resolveTemplateKey(key),
    resolveTemplatePath(templateSourceFilename(key)),
  ]);
  const [content, defaultContent] = await Promise.all([
    readFile(effectivePath, "utf8"),
    readFile(defaultPath, "utf8"),
  ]);
  return { key, filename, content, defaultContent, isOverridden: await hasOverride(key) };
}

export async function templatesWrite(_session: unknown, args: unknown): Promise<{ isOverridden: true }> {
  const key = requireEditableKey(args);
  const record = args as Record<string, unknown>;
  const content = record["content"];
  if (typeof content !== "string") {
    throw new Error("templates: write requires string content");
  }
  const dir = getTemplatesOverrideDir();
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, templateFilename(key));
  const temp = `${dest}.scvn-tmpl.tmp-${process.pid}`;
  await writeFile(temp, content, "utf8");
  await rename(temp, dest);
  return { isOverridden: true };
}

export async function templatesReset(_session: unknown, args: unknown): Promise<{ isOverridden: false }> {
  const key = requireEditableKey(args);
  const dest = path.join(getTemplatesOverrideDir(), templateFilename(key));
  try {
    await unlink(dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return { isOverridden: false };
}
