/**
 * test/features/node-runtime-staging.test.ts — stageNodeRuntime copies node into the bundle layout.
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { writeFile, chmod, stat } from "node:fs/promises";
import { tmpDir } from "../helpers/tmp-dir.js";
import { stageNodeRuntime } from "../../src/features/pack/node-runtime-staging.js";

describe("stageNodeRuntime", () => {
  it("copies the node binary to <staging>/node/bin/node, executable", async () => {
    const src = await tmpDir("scvn-node-src-");
    const staging = await tmpDir("scvn-node-stage-");
    const srcBin = path.join(src, "node");
    await writeFile(srcBin, "#!/bin/sh\necho NODE\n");
    await chmod(srcBin, 0o755);

    await stageNodeRuntime({ nodeBinPath: srcBin, stagingDir: staging });

    const dest = path.join(staging, "node", "bin", "node");
    const st = await stat(dest);
    expect(st.isFile()).toBe(true);
    expect((st.mode & 0o111) !== 0).toBe(true); // executable bit set
  });
});
