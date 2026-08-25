/**
 * test/writers/write-lfs-attributes.test.ts — LFS `.gitattributes` writer.
 *
 * Verifies idempotency, backup, and coexistence with a fork smart-merge block.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  writeLfsAttributes,
  loadUnityLfsAttributesBlock,
  LFS_MARKER_BEGIN,
} from "../../src/writers/write-lfs-attributes.js";
import { replaceMarkerBlock } from "../../src/lib/markers.js";
import { tmpDir } from "../helpers/tmp-dir.js";

describe("writeLfsAttributes", () => {
  it("creates .gitattributes with the LFS marker block", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, ".gitattributes");
    const r = await writeLfsAttributes({ gitattributesPath: file, overrideRoot: dir });
    expect(r.written).toBe(true);
    const content = await fs.readFile(file, "utf8");
    expect(content).toContain("# BEGIN scvn-lfs");
    expect(content).toContain("# END scvn-lfs");
    expect(content).toContain("*.png filter=lfs diff=lfs merge=lfs -text");
    expect(content).toContain("*.PNG filter=lfs diff=lfs merge=lfs -text");
    expect(content).toContain("*.fbx filter=lfs diff=lfs merge=lfs -text");
    expect(content).toContain("*.unitypackage filter=lfs diff=lfs merge=lfs -text");
  });

  it("is idempotent (written=false + byte-identical on re-run)", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, ".gitattributes");
    await writeLfsAttributes({ gitattributesPath: file, overrideRoot: dir });
    const first = await fs.readFile(file, "utf8");
    const r2 = await writeLfsAttributes({ gitattributesPath: file, overrideRoot: dir });
    expect(r2.written).toBe(false);
    const second = await fs.readFile(file, "utf8");
    expect(second).toBe(first);
  });

  it("coexists with a pre-seeded fork smart-merge block", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, ".gitattributes");
    // Seed user content + a fork block (default markers).
    const seeded = replaceMarkerBlock("*.cs text\n", "*.unity merge=unityyamlmerge");
    await fs.writeFile(file, seeded);

    const r = await writeLfsAttributes({ gitattributesPath: file, overrideRoot: dir });
    expect(r.written).toBe(true);

    const content = await fs.readFile(file, "utf8");
    expect(content.startsWith("*.cs text\n")).toBe(true);          // user content preserved
    expect(content).toContain("# BEGIN fork-unity-setup");          // fork block preserved
    expect(content).toContain("*.unity merge=unityyamlmerge");
    expect(content).toContain("# BEGIN scvn-lfs");                  // LFS block added
  });

  it("backs up an existing file before mutation", async () => {
    const dir = await tmpDir();
    const file = path.join(dir, ".gitattributes");
    await fs.writeFile(file, "*.cs text\n");
    const r = await writeLfsAttributes({ gitattributesPath: file, overrideRoot: dir });
    expect(r.backupPath).not.toBe("");
    const backup = await fs.readFile(r.backupPath, "utf8");
    expect(backup).toBe("*.cs text\n");
  });

  it("every glob line carries the full lfs filter attributes", async () => {
    const block = await loadUnityLfsAttributesBlock(await tmpDir());
    const globLines = block.split("\n").filter(
      (line) => line.trim() !== "" && !line.startsWith("#"),
    );
    expect(globLines.length).toBeGreaterThan(20);
    for (const line of globLines) {
      expect(line).toContain("filter=lfs diff=lfs merge=lfs -text");
    }
    // The block is inner content only — the marker is added by the writer.
    expect(block).not.toContain(LFS_MARKER_BEGIN);
  });

  it("loadUnityLfsAttributesBlock is byte-identical to the bundled template (extraction parity)", async () => {
    // The golden fixture is the committed template file itself — update it
    // alongside any intentional block change (see plan Phase 4 risk note).
    const templatePath = fileURLToPath(new URL("../../templates/gitattributes-lfs", import.meta.url));
    const template = await fs.readFile(templatePath, "utf8");
    const block = await loadUnityLfsAttributesBlock(await tmpDir());
    expect(block).toBe(template.replace(/\n+$/, ""));
  });
});
