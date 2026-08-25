/**
 * test/detectors/detect-beyond-compare.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { detectBeyondCompare } from "../../src/detectors/detect-beyond-compare.js";
import { tmpDir } from "../helpers/tmp-dir.js";

describe("detectBeyondCompare", () => {
  it("not-found when path missing", async () => {
    const dir = await tmpDir();
    const r = await detectBeyondCompare(path.join(dir, "no-bc"));
    expect(r).toEqual({ found: false, path: null });
  });

  it("found when executable exists", async () => {
    const dir = await tmpDir();
    const probe = path.join(dir, "bcomp");
    await fs.writeFile(probe, "#!/bin/sh\n");
    await fs.chmod(probe, 0o755);
    const r = await detectBeyondCompare(probe);
    expect(r.found).toBe(true);
    expect(r.path).toBe(probe);
  });
});
