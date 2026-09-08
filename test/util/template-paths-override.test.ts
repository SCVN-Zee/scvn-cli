/** Legacy override import and uncached preset resolution, with an isolated storage root. */

import { describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  resolveTemplateKey,
  resolveTemplatePath,
} from "../../src/util/template-paths.js";

describe("resolveTemplateKey — legacy customization import", () => {
  it("falls back to the bundled path when no override exists", async () => {
    const root = await tmpDir();
    const resolved = await resolveTemplateKey("gitignore", root);
    // Bundled default ships as `gitignore` (no dot); electron-builder strips a
    // packaged `.gitignore`. The `.gitignore` name is only the output/override.
    expect(resolved).toBe(await resolveTemplatePath("gitignore"));
  });

  it("imports the old override as custom content rather than redefining bundled Default", async () => {
    const root = await tmpDir();
    const dir = path.join(root, "templates");
    await mkdir(dir, { recursive: true });
    const override = path.join(dir, ".gitignore");
    await writeFile(override, "# override\n");

    const resolved = await resolveTemplateKey("gitignore", root);
    expect(resolved).not.toBe(override);
    expect(await readFile(resolved, "utf8")).toBe("# override\n");
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
    expect(await readFile(await resolveTemplateKey("gitattributesLfs", root), "utf8")).toBe("# custom lfs\n");
  });
});
