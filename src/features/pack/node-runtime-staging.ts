/**
 * features/pack/node-runtime-staging.ts — Stage a Node binary into a bundle.
 *
 * Copies the resolved `bin/node` (from node-dist's verified cache) into the bundle staging dir at
 * `<staging>/node/bin/node` — the exact layout `bin/scvn` reads. Pure fs so a test asserts the
 * destination path + exec bit on a tmp dir. Kept a SEPARATE call (not a syncSingleFolder tree) so
 * the existing assemble-bundle copy-sequence stays unchanged.
 */

import path from "node:path";
import { mkdir, copyFile, chmod } from "node:fs/promises";
import { BUNDLED_NODE_SUBPATH } from "./bundled-node-paths.js";

export interface StageNodeRuntimeOpts {
  /** Absolute path to a verified `bin/node` (from fetchNodeBinary). */
  nodeBinPath: string;
  /** Bundle staging dir (the dir that becomes the zip root). */
  stagingDir: string;
}

/** Copy the Node binary to `<stagingDir>/node/bin/node`, executable. */
export async function stageNodeRuntime(opts: StageNodeRuntimeOpts): Promise<void> {
  const dest = path.join(opts.stagingDir, BUNDLED_NODE_SUBPATH);
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(opts.nodeBinPath, dest);
  await chmod(dest, 0o755);
}
