/**
 * tsup.desktop.config.ts — Bundle the Electron main / preload / utility-process
 * host to CommonJS, independent of the CLI's own `tsup.config.ts`.
 *
 * Two builds:
 *  1. main + preload — plain CJS. The preload runs sandboxed, so it must not
 *     contain a Node `require` shim.
 *  2. host — CJS with an `import.meta.url` shim. The host bundles `src/` code
 *     that uses `import.meta.url` (e.g. util/install-root) to locate bundled
 *     assets; esbuild empties `import.meta` in CJS, so we redefine it to the
 *     emitted file's URL. The host runs in a full Node context, so the
 *     `require('node:url')` banner is safe there.
 *
 * `electron` is provided by the runtime and stays external.
 */

import { defineConfig } from "tsup";

// Build-time tab selection, baked into the host bundle (mirrors vite's define
// for the renderer). Unset/empty ships every tab.
const tabsDefine = { __SCVN_TABS__: JSON.stringify(process.env.SCVN_TABS ?? "") };
const shared = {
  outDir: "dist-desktop",
  format: ["cjs"] as const,
  platform: "node" as const,
  target: "node20",
  bundle: true,
  splitting: false,
  clean: false,
  sourcemap: true,
  external: ["electron"],
  outExtension: () => ({ js: ".cjs" }),
};

export default defineConfig([
  {
    ...shared,
    entry: { main: "desktop/main/index.ts", preload: "desktop/preload.ts" },
    esbuildOptions(options) {
      options.define = { ...options.define, ...tabsDefine };
    },
  },
  {
    ...shared,
    entry: { host: "desktop/host/index.ts" },
    esbuildOptions(options) {
      options.define = { ...options.define, "import.meta.url": "__scvnImportMetaUrl", ...tabsDefine };
      options.banner = {
        ...options.banner,
        js: "const __scvnImportMetaUrl = require('node:url').pathToFileURL(__filename).href;",
      };
    },
  },
]);
