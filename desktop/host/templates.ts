/** Preset management shares the CLI resolver; Default is bundled and read-only. */
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import {
  readTemplatePresets,
  saveTemplatePresets,
  writeTemplateFile,
  resolveTemplatePath,
  templateFilename,
  templatePresetPath,
  templateSourceFilename,
  type TemplatePresets,
} from "../../src/util/template-paths.js";
import {
  EDITABLE_TEMPLATE_KEYS,
  type EditableTemplateKey,
  type TemplateContent,
} from "../shared/commands.js";

function requireEditableKey(args: unknown): EditableTemplateKey {
  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const key = record["key"];
  if (typeof key !== "string" || !EDITABLE_TEMPLATE_KEYS.some((k) => k === key)) {
    throw new Error(`templates: not an editable template key: ${String(key)}`);
  }
  return key as EditableTemplateKey;
}

function requirePreset(args: unknown, state: TemplatePresets): string {
  const value = (args as Record<string, unknown>)["preset"];
  const preset = value === undefined ? state.selectedPreset : value;
  if (typeof preset !== "string" || !state.presets.some(p => p.id === preset)) {
    throw new Error("templates: unknown preset");
  }
  return preset;
}

function requireContent(args: unknown): string {
  const content = (args as Record<string, unknown>)["content"];
  if (typeof content !== "string") throw new Error("templates: write requires string content");
  return content;
}


// ponytail: serialize this host's small catalog mutations; use a file lock if multiple writers are supported.
let mutation: Promise<unknown> = Promise.resolve();
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const next = mutation.then(action);
  mutation = next.catch(() => {});
  return next;
}

export async function templatesRead(_session: unknown, args: unknown): Promise<TemplateContent> {
  const key = requireEditableKey(args);
  const state = await readTemplatePresets(key);
  const defaultContent = await readFile(await resolveTemplatePath(templateSourceFilename(key)), "utf8");
  const content = state.selectedPreset === "default"
    ? defaultContent
    : await readFile(templatePresetPath(key, state.selectedPreset), "utf8");
  return { key, filename: templateFilename(key), ...state, content, defaultContent, isOverridden: content !== defaultContent };
}

export async function templatesWrite(_session: unknown, args: unknown): Promise<{ isOverridden: true }> {
  return mutate(async () => {
    const key = requireEditableKey(args);
    const preset = requirePreset(args, await readTemplatePresets(key));
    if (preset === "default") throw new Error("templates: Default is read-only; create a custom preset");
    await writeTemplateFile(templatePresetPath(key, preset), requireContent(args));
    return { isOverridden: true };
  });
}

export async function templatesCreate(_session: unknown, args: unknown): Promise<TemplateContent> {
  return mutate(async () => {
    const key = requireEditableKey(args);
    const content = requireContent(args);
    const state = await readTemplatePresets(key);
    const rawName = (args as Record<string, unknown>)["name"];
    if (typeof rawName !== "string" || !rawName.trim() || rawName.trim().length > 80 || /[\x00-\x1f\x7f]/.test(rawName)) {
      throw new Error("templates: preset name must be 1–80 characters without control characters");
    }
    const name = rawName.trim();
    if (state.presets.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("templates: preset name already exists");
    }
    const id = randomUUID();
    const dest = templatePresetPath(key, id);
    await writeTemplateFile(dest, content);
    try {
      await saveTemplatePresets(key, { selectedPreset: id, presets: [...state.presets, { id, name }] });
    } catch (err) {
      await unlink(dest);
      throw err;
    }
    return templatesRead(null, { key });
  });
}

export async function templatesSelect(_session: unknown, args: unknown): Promise<TemplateContent> {
  return mutate(async () => {
    const key = requireEditableKey(args);
    const state = await readTemplatePresets(key);
    const selectedPreset = requirePreset(args, state);
    // Do not commit a selection whose saved content is missing or unreadable.
    if (selectedPreset !== "default") await readFile(templatePresetPath(key, selectedPreset));
    await saveTemplatePresets(key, { ...state, selectedPreset });
    return templatesRead(null, { key });
  });
}

export async function templatesDelete(_session: unknown, args: unknown): Promise<TemplateContent> {
  return mutate(async () => {
    const key = requireEditableKey(args);
    const state = await readTemplatePresets(key);
    const preset = requirePreset(args, state);
    if (preset === "default") throw new Error("templates: Default cannot be removed");
    // Publish the fallback before removing content so a failed catalog write loses nothing.
    await saveTemplatePresets(key, {
      selectedPreset: state.selectedPreset === preset ? "default" : state.selectedPreset,
      presets: state.presets.filter(p => p.id !== preset),
    });
    try {
      await unlink(templatePresetPath(key, preset));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return templatesRead(null, { key });
  });
}
