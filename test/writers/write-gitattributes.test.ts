/**
 * test/writers/write-gitattributes.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  writeGitAttributes,
  loadUnityGitAttributesBlock,
} from "../../src/writers/write-gitattributes.js";
import { tmpDir } from "../helpers/tmp-dir.js";

describe("writeGitAttributes", () => {
  it("creates .gitattributes with marker block", async () => {
    const dir = await tmpDir();
    const r = await writeGitAttributes({ projectPaths: [dir] });
    expect(r.perProject[0]!.written).toBe(true);
    const content = await fs.readFile(path.join(dir, ".gitattributes"), "utf8");
    expect(content).toContain("# BEGIN fork-unity-setup");
    expect(content).toContain("# END fork-unity-setup");
    expect(content).toContain("*.unity merge=unityyamlmerge");
    expect(content).toContain("*.mask merge=unityyamlmerge");
  });

  it("preserves non-marker content", async () => {
    const dir = await tmpDir();
    const target = path.join(dir, ".gitattributes");
    await fs.writeFile(target, "*.cs text\n");
    await writeGitAttributes({ projectPaths: [dir] });
    const content = await fs.readFile(target, "utf8");
    expect(content.startsWith("*.cs text\n")).toBe(true);
    expect(content).toContain("# BEGIN fork-unity-setup");
  });

  it("is idempotent (byte-identical on re-run)", async () => {
    const dir = await tmpDir();
    await writeGitAttributes({ projectPaths: [dir] });
    const first = await fs.readFile(path.join(dir, ".gitattributes"), "utf8");
    await writeGitAttributes({ projectPaths: [dir] });
    const second = await fs.readFile(path.join(dir, ".gitattributes"), "utf8");
    expect(second).toBe(first);
  });

  it("template block has all 14 merge globs and no eol=lf lines", async () => {
    const block = await loadUnityGitAttributesBlock();
    const mergeLines = block.match(/merge=unityyamlmerge/g);
    expect(mergeLines?.length).toBe(14);
    expect(block).not.toMatch(/text eol=lf/);
  });
});
