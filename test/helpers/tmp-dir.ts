/**
 * test/helpers/tmp-dir.ts — Create and auto-cleanup temporary directories in tests.
 *
 * Ported from fork-unity-setup/test/helpers/tmp-dir.ts.
 * Prefix updated to scvn- for clarity in OS temp listings.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach } from "vitest";

const created: string[] = [];

export async function tmpDir(prefix = "scvn-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length) {
    const d = created.pop();
    if (!d) continue;
    await fs.rm(d, { recursive: true, force: true });
  }
});
