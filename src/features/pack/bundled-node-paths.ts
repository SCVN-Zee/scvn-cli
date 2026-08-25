/**
 * features/pack/bundled-node-paths.ts — Layout contract for a CLI-bundled Node runtime.
 *
 * `make pack` ships a single Node binary INTO the bundle at `<install-root>/node/bin/node`
 * (a sibling of dist/ / templates/ / store/). The bash wrapper (bin/scvn) hardcodes the exact
 * same relative path, so this module is the single source of truth both sides agree on. One path,
 * no arch segment — a bundle carries exactly one arch (the producer's); a cross-arch consumer
 * falls back to system Node or guided install.
 *
 * Mirrors features/store/bundled-store-paths.ts.
 */

import path from "node:path";

/** Directory name holding the bundled Node runtime inside an install root / bundle. */
export const BUNDLED_NODE_DIRNAME = "node";

/**
 * Relative path from the install root to the bundled node executable. The bash wrapper hardcodes
 * the identical literal `node/bin/node`; a test asserts the two stay in lockstep.
 */
export const BUNDLED_NODE_SUBPATH = "node/bin/node";

/** Absolute path to the bundled node executable under `root`. */
export function bundledNodeBinPath(root: string): string {
  return path.join(root, BUNDLED_NODE_SUBPATH);
}
