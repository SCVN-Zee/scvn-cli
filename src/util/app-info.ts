/**
 * util/app-info.ts — Static app metadata: version (from package.json) + tagline.
 *
 * Single source of truth shared by cli (--version output) and the launcher
 * meta panel.
 *
 * Note on version lookup: in dev (tsx) modules keep their own URL, so __dirname
 * is `src/util/`; under tsup bundling everything collapses into `dist/cli.mjs`,
 * so __dirname is `dist/`. We walk up directories looking for package.json so
 * the same code works in both modes.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const APP_TAGLINE = "Unified Unity tooling";

/** Read `version` from the nearest ancestor package.json. */
export function getVersion(): string {
  const require = createRequire(import.meta.url);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const packageJson = require(path.join(dir, "package.json")) as { version: string };
      if (packageJson.version) return packageJson.version;
    } catch {
      // try parent
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.0.0";
}
