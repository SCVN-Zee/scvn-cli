/**
 * test/util/template-paths-override.test.ts — resolveTemplateKey's user-override
 * layer. The override root is injected (getTemplatesOverrideDir(overrideRoot)),
 * so no real ~/.scvn is touched. Proves: bundled fallback with no override,
 * override wins when present, and the probe is NOT cached (an override created
 * after a miss is seen on the next call).
 */

import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  resolveTemplateKey,
  resolveTemplatePath,
} from "../../src/util/template-paths.js";

describe("resolveTemplateKey — user override layer", () => {
  it("falls back to the bundled path when no override exists", async () => {
    const root = await tmpDir();
    const resolved = await resolveTemplateKey("gitignore", root);
    // Bundled default ships as `gitignore` (no dot); electron-builder strips a
    // packaged `.gitignore`. The `.gitignore` name is only the output/override.
    expect(resolved).toBe(await resolveTemplatePath("gitignore"));
  });

  it("prefers the override file under <root>/templates when present", async () => {
    const root = await tmpDir();
    const dir = path.join(root, "templates");
    await mkdir(dir, { recursive: true });
    const override = path.join(dir, ".gitignore");
    await writeFile(override, "# override\n");

    expect(await resolveTemplateKey("gitignore", root)).toBe(override);
  });

  it("probes every call — an override created after a miss is seen (not cached)", async () => {
    const root = await tmpDir();
    // First call: no override → bundled default (for the LFS key too).
    expect(await resolveTemplateKey("gitattributesLfs", root)).toBe(
      await resolveTemplatePath("gitattributes-lfs"),
    );

    const dir = path.join(root, "templates");
    await mkdir(dir, { recursive: true });
    const override = path.join(dir, "gitattributes-lfs");
    await writeFile(override, "# custom lfs\n");

    // Second call sees the freshly written override — no stale cache.
    expect(await resolveTemplateKey("gitattributesLfs", root)).toBe(override);
  });
});
