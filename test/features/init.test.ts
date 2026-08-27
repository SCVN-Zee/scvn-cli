import { describe, expect, it } from "vitest";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  InitValidationError,
  createDefaultInitLayout,
  initializeProject,
  parseInitLayout,
  prepareInit,
} from "../../src/features/init/index.js";

async function existsAt(value: string): Promise<boolean> {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

async function makeUnityProject(): Promise<{ project: string; assets: string }> {
  const project = await tmpDir("scvn-init-");
  const assets = path.join(project, "Assets");
  await mkdir(path.join(project, "ProjectSettings"));
  await mkdir(assets);
  await writeFile(path.join(project, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n");
  return { project, assets };
}

describe("initializer core", () => {
  it("creates the default full hierarchy below Assets", async () => {
    const { assets } = await makeUnityProject();
    const layout = createDefaultInitLayout("Combat");

    const result = await initializeProject({ targetAssets: assets, layout });

    expect(result.entries).toHaveLength(layout.directories.length);
    for (const relative of layout.directories) {
      expect(await existsAt(path.join(assets, ...relative.split("/")))).toBe(true);
    }
  });

  it("normalizes a selected Unity project root to its Assets child", async () => {
    const { project, assets } = await makeUnityProject();
    const result = await initializeProject({ targetAssets: project, layout: { directories: ["Custom"] } }, { dryRun: true });
    expect(result.targetAssets).toBe(assets);
    expect(result.entries[0]?.path).toBe(path.join(assets, "Custom"));
  });

  it("supports fully custom Assets-relative paths and dry-run", async () => {
    const { assets } = await makeUnityProject();
    const layout = { directories: ["Custom", "Custom/Demo", "Custom/Demo/Art/Models", "Scenes"] };

    const dry = await initializeProject({ targetAssets: assets, layout }, { dryRun: true });
    expect(dry.entries.every((entry) => entry.status === "planned")).toBe(true);
    expect(await existsAt(path.join(assets, "Custom"))).toBe(false);

    await initializeProject({ targetAssets: assets, layout });
    expect(await existsAt(path.join(assets, "Custom", "Demo", "Art", "Models"))).toBe(true);
    expect(await existsAt(path.join(assets, "Scenes"))).toBe(true);
  });

  it("preserves explicit parents, is idempotent, and rejects unsafe paths", async () => {
    const { assets } = await makeUnityProject();
    const layout = { directories: ["A", "A/B"] };
    expect(parseInitLayout(layout).directories).toEqual(["A", "A/B"]);
    await initializeProject({ targetAssets: assets, layout });

    const second = await initializeProject({ targetAssets: assets, layout });
    expect(second.entries.every((entry) => entry.status === "existing")).toBe(true);
    await expect(prepareInit({ targetAssets: assets, layout: { directories: ["../escape"] } })).rejects.toBeInstanceOf(InitValidationError);
    await expect(prepareInit({ targetAssets: assets, layout: { directories: ["Scenes", "Scenes"] } })).rejects.toThrow("Duplicate");
    expect(() => parseInitLayout({ root: "Supercent", directories: ["Scenes"] })).toThrow("no longer supported");
  });

  it("rejects file collisions before creating descendants", async () => {
    const { assets } = await makeUnityProject();
    await writeFile(path.join(assets, "Blocked"), "not a directory");

    await expect(initializeProject({ targetAssets: assets, layout: { directories: ["Blocked/Child"] } })).rejects.toThrow("file exists");
    expect(await existsAt(path.join(assets, "Blocked", "Child"))).toBe(false);
  });
});
