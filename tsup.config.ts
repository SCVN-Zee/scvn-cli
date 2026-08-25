import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.tsx"],
  target: "node20",
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
  // Define a top-level `require` in the ESM output so bundled CJS deps (e.g.
  // cross-spawn via execa) can `require("child_process")` — esbuild's dynamic-
  // require helper uses an ambient `require` when one is in scope. Without this
  // a `scvn pack` bundle (no node_modules) throws at startup.
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
  // Bundle runtime deps INTO dist/cli.mjs. tsup externalizes package.json
  // `dependencies` by default; without this, a `scvn pack` bundle (which ships
  // bin/ + dist/ + templates/ + store/ but NO node_modules) throws
  // ERR_MODULE_NOT_FOUND on a teammate's machine. These are pure-JS deps that
  // bundle cleanly, keeping the delivered CLI self-contained (Node 20 + PATH).
  noExternal: ["@clack/prompts", "execa", "fast-glob", "picocolors"],
});
