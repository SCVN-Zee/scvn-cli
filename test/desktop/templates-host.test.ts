/**
 * test/desktop/templates-host.test.ts — Host handlers for the per-feature
 * template editor (read/write/reset).
 *
 * The handlers resolve the override dir from getTemplatesOverrideDir() →
 * ~/.scvn/templates, so each test points HOME at a fresh temp dir (isolated;
 * never touches the real home). Proves the read/write/reset round-trip, the
 * non-editable-key rejection, and — the cross-surface guarantee — that a GUI
 * write is seen by the CLI read path (resolveTemplateKey) with no restart.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  templatesRead,
  templatesWrite,
  templatesReset,
} from "../../desktop/host/templates.js";
import type { TemplateContent } from "../../desktop/shared/commands.js";
import { getTemplatesOverrideDir } from "../../src/config/paths.js";
import { resolveTemplateKey } from "../../src/util/template-paths.js";

let realHome: string | undefined;

beforeEach(async () => {
  realHome = process.env["HOME"];
  process.env["HOME"] = await tmpDir("scvn-tmpl-home-");
});

afterEach(() => {
  if (realHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = realHome;
});

describe("templates host handlers", () => {
  it("read returns effective == bundled default when no override exists", async () => {
    const read = (await templatesRead(null, { key: "gitattributesLfs" })) as TemplateContent;
    expect(read.isOverridden).toBe(false);
    expect(read.content).toBe(read.defaultContent);
    expect(read.content.length).toBeGreaterThan(0);
  });

  it("write creates the override and read reflects it (isOverridden flips)", async () => {
    await templatesWrite(null, { key: "gitignore", content: "# my override\n*.custom\n" });

    const read = (await templatesRead(null, { key: "gitignore" })) as TemplateContent;
    expect(read.isOverridden).toBe(true);
    expect(read.content).toBe("# my override\n*.custom\n");
    expect(read.content).not.toBe(read.defaultContent);

    // The override file physically lives under ~/.scvn/templates.
    const overrideFile = path.join(getTemplatesOverrideDir(), ".gitignore");
    expect(await readFile(overrideFile, "utf8")).toBe("# my override\n*.custom\n");
  });

  it("a GUI write is honored by the CLI read path (resolveTemplateKey), no restart", async () => {
    await templatesWrite(null, { key: "gitignore", content: "# shared override\n" });
    // resolveTemplateKey is the exact path setupTemplate/CLI uses (uncached probe).
    const resolved = await resolveTemplateKey("gitignore");
    expect(resolved).toBe(path.join(getTemplatesOverrideDir(), ".gitignore"));
    expect(await readFile(resolved, "utf8")).toBe("# shared override\n");
  });

  it("reset removes the override and reverts to the bundled default", async () => {
    await templatesWrite(null, { key: "gitignore", content: "# temp\n" });
    const reset = await templatesReset(null, { key: "gitignore" });
    expect(reset).toEqual({ isOverridden: false });

    const read = (await templatesRead(null, { key: "gitignore" })) as TemplateContent;
    expect(read.isOverridden).toBe(false);
    expect(read.content).toBe(read.defaultContent);
  });

  it("reset is a no-op when no override exists (ENOENT ignored)", async () => {
    await expect(templatesReset(null, { key: "gitexclude" })).resolves.toEqual({ isOverridden: false });
  });

  it("write rejects a non-editable template key", async () => {
    await expect(templatesWrite(null, { key: "editorconfig", content: "x" })).rejects.toThrow(/not an editable/i);
  });

  it("gitattributesMerge is now editable (write + read round-trip)", async () => {
    const before = (await templatesRead(null, { key: "gitattributesMerge" })) as TemplateContent;
    expect(before.filename).toBe("gitattributes-merge");
    expect(before.isOverridden).toBe(false);
    expect(before.defaultContent.length).toBeGreaterThan(0);

    await templatesWrite(null, { key: "gitattributesMerge", content: "*.unity merge=custom\n" });
    const after = (await templatesRead(null, { key: "gitattributesMerge" })) as TemplateContent;
    expect(after.isOverridden).toBe(true);
    expect(after.content).toBe("*.unity merge=custom\n");
    expect(await readFile(path.join(getTemplatesOverrideDir(), "gitattributes-merge"), "utf8")).toBe(
      "*.unity merge=custom\n",
    );
  });

  it("read rejects a non-editable template key", async () => {
    await expect(templatesRead(null, { key: "nope" })).rejects.toThrow(/not an editable/i);
  });
});
