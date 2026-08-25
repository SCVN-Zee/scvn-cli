/**
 * features/mcp/extract-tarball.ts — Unpack an npm/OpenUPM tarball into a package dir.
 *
 * Both registries wrap their contents in a single `package/` root, so
 * `--strip-components=1` lands the package's own files at the destination root.
 *
 * Extraction runs through the system `tar` with array args (never a shell
 * string), which is what lets the cache path carry a space.
 *
 * Ports `extract_tarball` (unity-mcp-localize.sh:247).
 */

import { mkdir } from "node:fs/promises";
import { execa } from "execa";

/** Extract `<tgz>` into `<destDir>`, stripping the tarball's `package/` root. */
export async function extractTarball(tgz: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await execa("tar", ["-xzf", tgz, "-C", destDir, "--strip-components=1"]);
}
