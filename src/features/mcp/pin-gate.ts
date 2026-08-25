/**
 * features/mcp/pin-gate.ts — Refuse to install an addon that pins a different core.
 *
 * Addons declare an exact dependency on one core version. Installing a skewed
 * pair COMPILES cleanly and then fails at runtime as an opaque MCP tool error —
 * there is no compile error to catch it, which is precisely why this gate exists.
 *
 * Three states, and the third is the one that matters:
 *   true   → verified, pass
 *   false  → skew, fail (unless --force accepts the runtime risk)
 *   ABSENT → the version dir predates pin tracking. GRANDFATHER it: never fail
 *            an install because the cache is simply older than the feature.
 *
 * Ports `pin_gate` (unity-mcp-localize.sh:708).
 */

import { readVersionsJson, skewedInDoc } from "./versions-json.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface PinGateOpts {
  force?: boolean;
  reporter?: Pick<SyncReporter, "onLog">;
}

/**
 * Throw when any package in `wanted` is recorded as NOT pinning `coreVersion`.
 * A version dir with no `pins` key at all passes untouched.
 */
export async function pinGate(
  verDirPath: string,
  coreVersion: string,
  wanted: readonly string[],
  opts: PinGateOpts = {},
): Promise<void> {
  const doc = await readVersionsJson(verDirPath);

  if (doc.pins === undefined) {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "info",
      message: `V${coreVersion} predates pin tracking — re-fetch to verify addon pins`,
    });
    return;
  }

  const skewed = skewedInDoc(doc, wanted);
  if (skewed.length === 0) return;

  if (opts.force) {
    opts.reporter?.onLog({
      ts: Date.now(),
      level: "warn",
      message:
        `pin mismatch (--force): ${skewed.join(", ")} do not pin core ${coreVersion} — ` +
        `MCP tools may fail at runtime`,
    });
    return;
  }

  // A bare `scvn mcp install` now solves the core against the addon set, so
  // reaching this means the version was named explicitly (or came from a marker
  // or a bundle). Name the command form: "pick an older core" is not actionable
  // if you do not know install takes one.
  throw new Error(
    `pin gate FAILED — these addons do not pin core ${coreVersion}:\n` +
      `    ${skewed.join(", ")}\n` +
      `  The addon authors have not published a build for this core yet.\n` +
      `  Let scvn choose:  scvn mcp install            (picks the newest core your addons support)\n` +
      `  Or name another:  scvn mcp install <coreVer>\n` +
      `  Or accept the runtime skew: re-run with --force.`,
  );
}
