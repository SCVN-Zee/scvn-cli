/**
 * test/lib/backup.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { backupFile } from "../../src/lib/backup.js";
import { tmpDir } from "../helpers/tmp-dir.js";

describe("backupFile", () => {
  it("returns '' for missing source", async () => {
    const dir = await tmpDir();
    const result = await backupFile(path.join(dir, "nope"));
    expect(result).toBe("");
  });

  it("creates a timestamped copy", async () => {
    const dir = await tmpDir();
    const src = path.join(dir, "data.txt");
    await fs.writeFile(src, "hello");
    const bak = await backupFile(src);
    expect(bak).toMatch(/\.fork-unity-setup\.bak-\d{8}-\d{6}$/);
    const content = await fs.readFile(bak, "utf8");
    expect(content).toBe("hello");
    const srcStill = await fs.readFile(src, "utf8");
    expect(srcStill).toBe("hello");
  });
});
