/**
 * test/lib/verify-fork-prefs.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 * Fixture path updated to scvn test/fixtures/.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { parseDefaultsReadDict } from "../../src/lib/verify-fork-prefs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseDefaultsReadDict", () => {
  it("parses sample fixture", async () => {
    const text = await fs.readFile(
      path.resolve(__dirname, "../fixtures/defaults-read-diff.txt"),
      "utf8",
    );
    const r = parseDefaultsReadDict(text);
    expect(r).not.toBeNull();
    expect(r!.Type).toBe("BeyondCompare");
    expect(r!.ApplicationPath).toBe(
      "/Applications/Beyond Compare.app/Contents/MacOS/bcomp",
    );
    expect(r!.Arguments).toBe("$LOCAL $REMOTE");
  });

  it("returns null if not a dict", () => {
    expect(parseDefaultsReadDict("not a dict")).toBeNull();
  });
});
