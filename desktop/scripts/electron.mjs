import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, cpSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export let electronPath = require("electron");

// Cmd-Tab reads the native bundle, not BrowserWindow.title or app.setName().
// Keep node_modules untouched and reuse a branded copy until its inputs change.
if (process.platform === "darwin") {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const source = path.resolve(electronPath, "../../..");
  const icon = path.join(root, "desktop/build/icon.icns");
  const config = readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const name = /^productName: (.+)$/m.exec(config)?.[1]?.trim();
  if (!name || /[/\\]/.test(name)) throw new Error("Invalid electron-builder productName");
  const hash = createHash("sha256")
    .update(readFileSync(path.join(source, "Contents/Info.plist")))
    .update(readFileSync(icon)).update(name).digest("hex").slice(0, 16);
  const cache = path.join(root, ".cache/desktop-runtime", hash);
  const bundle = path.join(cache, `${name}.app`);
  if (!existsSync(bundle)) {
    mkdirSync(cache, { recursive: true });
    const staging = path.join(cache, `${process.pid}.app`);
    cpSync(source, staging, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
    const plist = path.join(staging, "Contents/Info.plist");
    for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
      execFileSync("/usr/bin/plutil", ["-replace", key, "-string", name, plist]);
    }
    execFileSync("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "com.supercent.scvn.dev", plist]);
    cpSync(icon, path.join(staging, "Contents/Resources/electron.icns"));
    execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", staging], { stdio: "pipe" });
    renameSync(staging, bundle);
  }
  electronPath = path.join(bundle, "Contents/MacOS/Electron");
}
