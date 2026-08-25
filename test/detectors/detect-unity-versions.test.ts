/**
 * test/detectors/detect-unity-versions.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import fs from "fs/promises";
import path from "path";
import { describe, expect, it } from "vitest";
import { detectUnityVersions } from "../../src/detectors/detect-unity-versions.js";
import { tmpDir } from "../helpers/tmp-dir.js";

// Classic layout (Unity ≤ 6000.0): binary + spec both under Contents/Tools.
async function makeUnity(root: string, version: string): Promise<void> {
  const yamlDir = path.join(root, version, "Unity.app/Contents/Tools");
  await fs.mkdir(yamlDir, { recursive: true });
  await fs.writeFile(path.join(yamlDir, "UnityYAMLMerge"), "");
  await fs.writeFile(path.join(yamlDir, "mergespecfile.txt"), "");
}

// Relocated layout (Unity 6000.3+): binary under Contents/Helpers, spec under
// Contents/Resources/UnityYAMLMerge — Contents/Tools no longer exists.
async function makeUnity6000_3(root: string, version: string): Promise<void> {
  const contents = path.join(root, version, "Unity.app/Contents");
  await fs.mkdir(path.join(contents, "Helpers"), { recursive: true });
  await fs.writeFile(path.join(contents, "Helpers/UnityYAMLMerge"), "");
  await fs.mkdir(path.join(contents, "Resources/UnityYAMLMerge"), { recursive: true });
  await fs.writeFile(path.join(contents, "Resources/UnityYAMLMerge/mergespecfile.txt"), "");
}

describe("detectUnityVersions", () => {
  it("returns [] for missing hub dir", async () => {
    const dir = await tmpDir();
    const r = await detectUnityVersions(path.join(dir, "no-hub"));
    expect(r).toEqual([]);
  });

  it("finds Unity versions and sorts newest first", async () => {
    const hub = await tmpDir();
    await makeUnity(hub, "2022.3.19f1");
    await makeUnity(hub, "6000.0.1f1");
    await fs.mkdir(path.join(hub, "not-a-unity-dir"));

    const r = await detectUnityVersions(hub);
    expect(r.map((v) => v.version)).toEqual(["6000.0.1f1", "2022.3.19f1"]);
    expect(r[0]!.yamlMergePath).toContain("UnityYAMLMerge");
    expect(r[0]!.mergeSpecPath).toContain("mergespecfile.txt");
  });

  it("skips entries without UnityYAMLMerge", async () => {
    const hub = await tmpDir();
    await fs.mkdir(path.join(hub, "empty-version"));
    const r = await detectUnityVersions(hub);
    expect(r).toEqual([]);
  });

  it("detects the relocated 6000.3 layout (Helpers/ + Resources/)", async () => {
    const hub = await tmpDir();
    await makeUnity6000_3(hub, "6000.3.15f1");

    const r = await detectUnityVersions(hub);
    expect(r.map((v) => v.version)).toEqual(["6000.3.15f1"]);
    expect(r[0]!.yamlMergePath).toContain("Contents/Helpers/UnityYAMLMerge");
    expect(r[0]!.mergeSpecPath).toContain("Contents/Resources/UnityYAMLMerge/mergespecfile.txt");
  });

  it("finds classic and relocated layouts side by side", async () => {
    const hub = await tmpDir();
    await makeUnity(hub, "2022.3.19f1");        // classic Contents/Tools
    await makeUnity6000_3(hub, "6000.3.15f1");  // relocated Helpers/ + Resources/

    const r = await detectUnityVersions(hub);
    expect(r.map((v) => v.version)).toEqual(["6000.3.15f1", "2022.3.19f1"]);
    expect(r[0]!.yamlMergePath).toContain("Contents/Helpers/UnityYAMLMerge");
    expect(r[1]!.yamlMergePath).toContain("Contents/Tools/UnityYAMLMerge");
  });

  it("sorts numerically so 6000.10 outranks 6000.3", async () => {
    const hub = await tmpDir();
    await makeUnity(hub, "6000.3.15f1");
    await makeUnity(hub, "6000.10.0f1");

    const r = await detectUnityVersions(hub);
    expect(r.map((v) => v.version)).toEqual(["6000.10.0f1", "6000.3.15f1"]);
  });
});
