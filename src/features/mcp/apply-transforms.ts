/**
 * features/mcp/apply-transforms.ts — The transform pipeline, applied once at fetch.
 *
 * Runs against the CACHE, never a project tree: a version dir holds transformed
 * working copies that are pristine by construction, so an install is a plain
 * rsync of already-correct source.
 *
 * Every package is pruned; only the core carries the two C# shims.
 *
 * Ports `apply_transforms` (unity-mcp-localize.sh:321).
 */

import { CORE_PKG } from "./mcp-constants.js";
import { pruneTests } from "./transforms/prune-tests.js";
import { applyRelocationShim } from "./transforms/relocation-shim.js";
import { applyWebglShim } from "./transforms/webgl-shim.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface ApplyTransformsOpts {
  reporter?: Pick<SyncReporter, "onLog">;
}

/** Transform an extracted package tree in place. Idempotent. */
export async function applyTransforms(
  pkgDir: string,
  pkgName: string,
  opts: ApplyTransformsOpts = {},
): Promise<void> {
  await pruneTests(pkgDir);

  if (pkgName === CORE_PKG) {
    // Throws on drift — a core that cannot be shimmed is never staged.
    await applyRelocationShim(pkgDir);
    await applyWebglShim(pkgDir, opts);
  }
}
