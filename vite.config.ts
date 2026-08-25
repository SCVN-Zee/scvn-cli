/**
 * vite.config.ts — Renderer (sandboxed React UI) dev server + production build.
 *
 * Only the `desktop/renderer` tree is a Vite app. `base: "./"` keeps asset URLs
 * relative so the packaged app can load the built HTML over `file://`. React +
 * Tailwind v4 power the shadcn-style UI; `@` resolves to the renderer root and
 * `@shared` to the IPC/command contract shared with the host.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const rendererRoot = fileURLToPath(new URL("./desktop/renderer", import.meta.url));
const sharedRoot = fileURLToPath(new URL("./desktop/shared", import.meta.url));
const outDir = fileURLToPath(new URL("./dist-desktop/renderer", import.meta.url));
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version as string;

export default defineConfig({
  root: rendererRoot,
  define: {
    // Build-time tab selection: baked so the shipped renderer reads it, not the
    // end user's env. Unset/empty ships every tab. Mirrored in tsup for the host.
    __SCVN_TABS__: JSON.stringify(process.env.SCVN_TABS ?? ""),
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": rendererRoot, "@shared": sharedRoot },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "chrome130",
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
