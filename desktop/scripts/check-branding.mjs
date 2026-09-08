// Run with: node desktop/scripts/check-branding.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { electronPath } from "./electron.mjs";

if (process.platform === "darwin") {
  const bundle = path.resolve(electronPath, "../../..");
  const plist = path.join(bundle, "Contents/Info.plist");
  const name = /^productName: (.+)$/m.exec(readFileSync(new URL("../../electron-builder.yml", import.meta.url), "utf8"))[1].trim();
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    assert.equal(execFileSync("/usr/bin/plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim(), name);
  }
  assert.deepEqual(readFileSync(path.join(bundle, "Contents/Resources/electron.icns")), readFileSync(new URL("../build/icon.icns", import.meta.url)));
  // Also catches broken framework symlinks after copying the runtime.
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  console.log("Native app name, icon, and bundle signature verified.");
}
