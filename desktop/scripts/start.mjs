import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { electronPath } from "./electron.mjs";

const child = spawn(electronPath, [fileURLToPath(new URL("../../dist-desktop/main.cjs", import.meta.url))], { stdio: "inherit" });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
