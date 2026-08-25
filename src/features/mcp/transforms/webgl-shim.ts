/**
 * features/mcp/transforms/webgl-shim.ts — Keep UNITY_MCP_READY out of WebGL exports.
 *
 * The plugin's DependencyResolver walks every BuildTargetGroup and defines
 * UNITY_MCP_READY on each. That define gates the MCP Runtime asmdef, so on a
 * WebGL/Luna playable export the whole MCP runtime would be compiled into the
 * shipped build. Skipping the WebGL group stops the resolver adding it.
 *
 * WARNS on drift rather than throwing — the opposite of the relocation shim. A
 * missed WebGL skip costs a bloated playable export; a missed relocation costs a
 * plugin that loads nothing. Only one of those is worth blocking an install for.
 *
 * Ports `apply_webgl_shim` (unity-mcp-localize.sh:291).
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import type { SyncReporter } from "../../transfer/reporter.js";

const GATE_REL = "Editor/DependencyResolver/RecompileGate.cs";

/** Whitespace-tolerant: upstream reindents this block from time to time. */
const ANCHOR = /if \(group == BuildTargetGroup\.Unknown\)\s*\n\s*continue;\n/;

const INJECTION =
  "\n                // WebGL excluded: keeps UNITY_MCP_READY (and the MCP Runtime asmdef it\n" +
  "                // gates) out of Luna / WebGL player exports.\n" +
  "                if (group == BuildTargetGroup.WebGL)\n" +
  "                    continue;\n";

export interface WebglShimOpts {
  reporter?: Pick<SyncReporter, "onLog">;
}

function warn(opts: WebglShimOpts, message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level: "warn", message });
}

/** Inject the WebGL skip into the core package's RecompileGate.cs. Idempotent. */
export async function applyWebglShim(
  pkgDir: string,
  opts: WebglShimOpts = {},
): Promise<void> {
  const file = path.join(pkgDir, GATE_REL);

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    warn(opts, `WebGL shim: ${GATE_REL} missing at ${file} — skipping`);
    return;
  }

  if (text.includes("BuildTargetGroup.WebGL")) return; // already applied

  const match = ANCHOR.exec(text);
  if (match === null) {
    warn(
      opts,
      `WebGL shim: anchor (BuildTargetGroup.Unknown guard) not found in ${GATE_REL} — ` +
        `the MCP Runtime may enter WebGL/Luna exports; verify manually`,
    );
    return;
  }

  const end = match.index + match[0].length;
  await writeFile(file, text.slice(0, end) + INJECTION + text.slice(end), "utf8");
}
