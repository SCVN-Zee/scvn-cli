/**
 * desktop/scripts/dev.mjs — Dev launcher: bundle main/host/preload, serve the
 * renderer with Vite, then launch Electron pointed at the dev server.
 *
 * Run via `npm run desktop:dev`. Ctrl-C (or the window closing) tears both down.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const electronPath = require("electron"); // path to the Electron executable
const mainEntry = fileURLToPath(new URL("../../dist-desktop/main.cjs", import.meta.url));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    child.on("error", reject);
  });
}

// 1. Bundle main / preload / host to dist-desktop/*.cjs.
await run("npx", ["tsup", "--config", "tsup.desktop.config.ts"]);

// 2. Start the Vite dev server for the renderer.
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error("vite: no local dev URL");
process.stdout.write(`renderer dev server: ${url}\n`);

// 3. Launch Electron against the dev server.
const electron = spawn(electronPath, [mainEntry], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const shutdown = async () => {
  await server.close();
  if (!electron.killed) electron.kill();
  process.exit(0);
};

electron.on("exit", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
