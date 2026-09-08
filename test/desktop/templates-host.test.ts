import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  templatesRead, templatesWrite,
  templatesCreate, templatesSelect, templatesDelete,
} from "../../desktop/host/templates.js";
import { EDITABLE_TEMPLATE_KEYS } from "../../desktop/shared/commands.js";
import { getTemplatesOverrideDir } from "../../src/config/paths.js";
import {
  resolveTemplateKey, resolveTemplatePath, templateFilename, templateSourceFilename, templatePresetsDir,
} from "../../src/util/template-paths.js";

let realHome: string | undefined;
beforeEach(async () => {
  realHome = process.env["HOME"];
  process.env["HOME"] = await tmpDir("scvn-tmpl-home-");
});
afterEach(() => {
  if (realHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = realHome;
});

const key = "gitignore";

describe("template presets", () => {
  it.each(EDITABLE_TEMPLATE_KEYS)("%s: Default is bundled and immutable, custom presets remain editable", async (key) => {
    const bundled = await readFile(await resolveTemplatePath(templateSourceFilename(key)), "utf8");
    const initial = await templatesRead(null, { key });
    expect(initial.content).toBe(bundled);
    expect(initial.selectedPreset).toBe("default");
    for (const operation of [templatesWrite, templatesDelete]) {
      await expect(operation(null, { key, preset: "default", content: "changed" })).rejects.toThrow();
    }
    expect(await templatesRead(null, { key })).toEqual(initial);

    const custom = await templatesCreate(null, { key, name: "Mine", content: bundled });
    await templatesWrite(null, { key, preset: custom.selectedPreset, content: "# custom\n" });
    expect(await readFile(await resolveTemplateKey(key), "utf8")).toBe("# custom\n");
    await templatesWrite(null, { key, content: "# saved custom\n" });
    expect((await templatesSelect(null, { key, preset: "default" })).content).toBe(bundled);
    expect(await resolveTemplateKey(key)).toBe(await resolveTemplatePath(templateSourceFilename(key)));
    expect((await templatesSelect(null, { key, preset: custom.selectedPreset })).content).toBe("# saved custom\n");
    const deleted = await templatesDelete(null, { key });
    expect(deleted.selectedPreset).toBe("default");
    expect(deleted.content).toBe(bundled);
    expect(deleted.presets).toEqual([{ id: "default", name: "Default" }]);
  });

  it("imports old Default customizations once, without changing bundled Default or resurrecting deleted presets", async () => {
    await mkdir(getTemplatesOverrideDir(), { recursive: true });
    const legacy = path.join(getTemplatesOverrideDir(), templateFilename(key));
    await writeFile(legacy, "# old customization\n");
    const [first, second] = await Promise.all([templatesRead(null, { key }), templatesRead(null, { key })]);
    expect(second).toEqual(first);
    expect(first.content).toBe("# old customization\n");
    expect(first.presets.map(p => p.name)).toEqual(["Default", "Previous Default"]);
    expect(first.selectedPreset).not.toBe("default");
    const original = await templatesSelect(null, { key, preset: "default" });
    expect(original.content).toBe(original.defaultContent);
    expect(await readFile(await resolveTemplateKey(key), "utf8")).toBe(original.defaultContent);
    expect((await templatesSelect(null, { key, preset: first.selectedPreset })).content).toBe("# old customization\n");
    await templatesDelete(null, { key, preset: first.selectedPreset });
    expect((await templatesRead(null, { key })).presets).toEqual([{ id: "default", name: "Default" }]);
    expect(await readFile(legacy, "utf8")).toBe("# old customization\n");
  });

  it("imports a legacy override alongside an existing selected custom preset without a name collision", async () => {
    const selected = await templatesCreate(null, { key, name: "Previous Default", content: "# selected\n" });
    const catalog = path.join(templatePresetsDir(key), "index.json");
    // The preceding app version had no catalog version and an editable Default override.
    await writeFile(catalog, JSON.stringify({ selectedPreset: selected.selectedPreset, presets: selected.presets }));
    await writeFile(path.join(getTemplatesOverrideDir(), templateFilename(key)), "# older default\n");
    const imported = await templatesRead(null, { key });
    expect(imported.selectedPreset).toBe(selected.selectedPreset);
    expect(imported.content).toBe("# selected\n");
    const previous = imported.presets.find(p => p.name === "Previous Default 2")!;
    expect((await templatesSelect(null, { key, preset: previous.id })).content).toBe("# older default\n");
  });

  it("deleting a non-selected preset preserves selection and deleting the selected one falls back to bundled Default", async () => {
    const a = await templatesCreate(null, { key, name: "A", content: "# a\n" });
    const b = await templatesCreate(null, { key, name: "B", content: "# b\n" });
    const deletedA = await templatesDelete(null, { key, preset: a.selectedPreset });
    expect(deletedA.selectedPreset).toBe(b.selectedPreset);
    expect(deletedA.content).toBe("# b\n");
    const deletedB = await templatesDelete(null, { key, preset: b.selectedPreset });
    expect(deletedB.selectedPreset).toBe("default");
    expect(deletedB.content).toBe(deletedB.defaultContent);
  });

  it("presets are isolated per template type", async () => {
    await templatesCreate(null, { key, name: "Mine", content: "# mine\n" });
    const other = await templatesRead(null, { key: "gitexclude" });
    expect(other.presets).toEqual([{ id: "default", name: "Default" }]);
    expect(other.content).toBe(other.defaultContent);
  });

  it("rejects duplicate, empty, oversized and control-character names without changing the active preset", async () => {
    const before = await templatesCreate(null, { key, name: " Unity ", content: "# keep\n" });
    expect(before.presets.find(p => p.id === before.selectedPreset)?.name).toBe("Unity");
    for (const name of [" unity ", " default ", "", "   ", "a".repeat(81), "bad\nname"]) {
      await expect(templatesCreate(null, { key, name, content: "# wrong\n" })).rejects.toThrow();
    }
    expect(await templatesRead(null, { key })).toEqual(before);
  });

  it("rejects malformed content, keys and preset IDs without modifying custom content", async () => {
    const before = await templatesCreate(null, { key, name: "Keep", content: "# keep\n" });
    await expect(templatesCreate(null, { key, name: "Bad", content: 42 })).rejects.toThrow();
    await expect(templatesWrite(null, { key, content: null })).rejects.toThrow();
    for (const operation of [templatesSelect, templatesWrite, templatesDelete]) {
      await expect(operation(null, { key, preset: "../escape", content: "bad" })).rejects.toThrow();
      await expect(operation(null, { key: "nope", content: "bad" })).rejects.toThrow();
    }
    expect(await templatesRead(null, { key })).toEqual(before);
  });
});
