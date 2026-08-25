/**
 * features/mcp/transforms/relocation-shim.ts — Point the core's asset loader at the
 * vendored location.
 *
 * Upstream `EditorAssetLoader.cs` resolves editor assets from
 * `Packages/com.ivanmurzak.unity.mcp/` (the UPM path) and ships the Assets/
 * fallback commented out. Vendoring as source means the UPM path does not exist,
 * so the const is repointed and the fallback uncommented.
 *
 * THROWS on drift. A silently-unshimmed loader still COMPILES — it just resolves
 * zero editor assets at runtime, which surfaces much later as an opaque plugin
 * failure. There is no safe way to guess here, so a missing pattern is fatal.
 *
 * Ports `apply_relocation_shim` (unity-mcp-localize.sh:256).
 */

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const LOADER_REL = "Editor/Scripts/Utils/EditorAssetLoader.cs";

interface Swap {
  old: string;
  next: string;
  name: string;
}

/**
 * The three edits, in order. Each is anchored on enough context to be unique:
 * swap 1 carries the full `AssetsPathPrefix = …` declaration so the identically
 * valued `PackagePathPrefix` line is left alone.
 */
const SWAPS: readonly Swap[] = [
  {
    old: 'private const string AssetsPathPrefix = "Packages/com.ivanmurzak.unity.mcp/";',
    next: 'private const string AssetsPathPrefix = "Assets/UnityMCP/com.ivanmurzak.unity.mcp/";',
    name: "AssetsPathPrefix const",
  },
  {
    old: "//AssetsPathPrefix + relativePath",
    next: "AssetsPathPrefix + relativePath",
    name: "fallback array element",
  },
  {
    old: "PackagePathPrefix + relativePath//,",
    next: "PackagePathPrefix + relativePath,",
    name: "first array element comma",
  },
];

/**
 * Apply one swap. Probes `old` BEFORE `next` — and that order is the whole
 * subtlety. In swap 2 the replacement (`AssetsPathPrefix + relativePath`) is a
 * SUBSTRING of what it replaces (`//AssetsPathPrefix + relativePath`), so a
 * "have I already applied this?" check that looked for `next` first would find
 * it inside the un-applied line, declare victory, and leave the fallback
 * commented out forever.
 */
function swap(text: string, spec: Swap): string {
  if (text.includes(spec.old)) return text.replace(spec.old, spec.next);
  if (text.includes(spec.next)) return text; // genuinely already applied
  throw new Error(
    `DRIFT: relocation shim pattern not found (${spec.name}) in ${LOADER_REL} — ` +
      `upstream changed. Inspect the package before installing it.`,
  );
}

/** Rewrite the core package's EditorAssetLoader.cs in place. Idempotent. */
export async function applyRelocationShim(pkgDir: string): Promise<void> {
  const file = path.join(pkgDir, LOADER_REL);

  let original: string;
  try {
    original = await readFile(file, "utf8");
  } catch {
    throw new Error(
      `relocation shim: ${LOADER_REL} missing at ${file} (upstream drift?)`,
    );
  }

  let text = original;
  for (const spec of SWAPS) {
    text = swap(text, spec);
  }

  if (text !== original) await writeFile(file, text, "utf8");
}
