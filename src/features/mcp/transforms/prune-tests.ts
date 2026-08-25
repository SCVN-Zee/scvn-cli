/**
 * features/mcp/transforms/prune-tests.ts — Drop test trees from a vendored package.
 *
 * Vendored packages are compiled by Unity as ordinary Assets/ source, so a
 * package's Tests/ would drag its test-framework asmdef references into the
 * project's compilation. UPM never compiled them; vendoring would.
 *
 * Ports `prune_tests` (unity-mcp-localize.sh:314). Idempotent by construction —
 * `rm -rf` semantics, absent is fine.
 */

import path from "node:path";
import { rm } from "node:fs/promises";

const PRUNED_DIRS = ["Tests", "TestFiles"] as const;

/** Remove Tests/ and TestFiles/ (and their Unity .meta siblings) from a package. */
export async function pruneTests(pkgDir: string): Promise<void> {
  for (const dir of PRUNED_DIRS) {
    await rm(path.join(pkgDir, dir), { recursive: true, force: true });
    await rm(path.join(pkgDir, `${dir}.meta`), { force: true });
  }
}
