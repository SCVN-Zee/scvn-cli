/**
 * test/lib/check-mergespecfile.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 * Fixture paths updated to scvn test/fixtures/.
 */

import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { checkMergespecfile } from "../../src/lib/check-mergespecfile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, "../fixtures");

describe("checkMergespecfile", () => {
  it("ok when BC line present", async () => {
    const r = await checkMergespecfile(path.join(fixtures, "mergespecfile-with-bc.txt"));
    expect(r.ok).toBe(true);
  });

  it("not ok when BC line missing", async () => {
    const r = await checkMergespecfile(path.join(fixtures, "mergespecfile-without-bc.txt"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("not found");
  });

  it("warn on missing file", async () => {
    const r = await checkMergespecfile(path.join(fixtures, "does-not-exist.txt"));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("cannot read");
  });
});
