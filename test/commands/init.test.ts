import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInit } from "../../src/commands/init.js";
import { fakeOutput } from "../../src/ui/output.js";
import { fakePrompt } from "../../src/ui/prompt.js";
import { tmpDir } from "../helpers/tmp-dir.js";

describe("runInit", () => {
  it("creates the default hierarchy from explicit noninteractive args", async () => {
    const root = await tmpDir("scvn-init-command-");
    const assets = path.join(root, "Assets");
    await mkdir(path.join(root, "ProjectSettings"));
    await mkdir(assets);
    await writeFile(path.join(root, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.0.1f1\n");
    const output = fakeOutput();

    await runInit({ target: assets, name: "Demo", autoYes: true }, fakePrompt([]), output);

    expect(output.calls.some((call) => call.type === "success")).toBe(true);
  });

  it("requires a target under --yes", async () => {
    const output = fakeOutput();
    await runInit({ name: "Demo", autoYes: true }, fakePrompt([]), output);
    expect(output.calls.some((call) => call.type === "error" && call.message.includes("requires an explicit target"))).toBe(true);
  });

  it("rejects --name with a custom layout", async () => {
    const root = await tmpDir("scvn-init-command-");
    const assets = path.join(root, "Assets");
    await mkdir(assets);
    const output = fakeOutput();

    await runInit({ target: assets, name: "Demo", layout: "layout.json" }, fakePrompt([]), output);

    expect(output.calls.some((call) => call.type === "error" && call.message.includes("cannot be combined"))).toBe(true);
  });
});
