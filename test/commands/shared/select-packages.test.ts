/**
 * test/commands/shared/select-packages.test.ts
 *
 * The add side no longer scans a catalog — a folder is picked and resolved by
 * resolveAddFolder (covered in test/features/resolve-add-folder.test.ts). What
 * remains here are the staged-package selectors for import (default ALL) and
 * remove (opt-in each), which read meta.json and never a catalog.
 */

import { describe, it, expect, vi } from "vitest";
import type { PromptAdapter } from "../../../src/ui/prompt.js";
import type { PackagesStoreMeta } from "../../../src/features/store/store-meta.js";
import {
  selectStagedPackages,
  selectStagedPackagesToRemove,
} from "../../../src/commands/shared/select-packages.js";

function fakePrompt(multiselect: string[]): PromptAdapter {
  return {
    select:      vi.fn(),
    multiselect: vi.fn().mockResolvedValue(multiselect),
    text:        vi.fn(),
    confirm:     vi.fn(),
  } as unknown as PromptAdapter;
}

const meta = {
  kind: "packages",
  version: 2,
  packages: [
    { label: "vFolders",       relPath: "Assets/vFolders",        bytes: 1 },
    { label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 2 },
    { label: "Foo",            relPath: "Packages/Foo",           bytes: 3 },
    { label: "Foo",            relPath: "Assets/Foo",             bytes: 4 },
  ],
} as PackagesStoreMeta;

describe("selectStagedPackages — import side", () => {
  it("autoYes → all staged", async () => {
    expect(await selectStagedPackages(meta, true, fakePrompt([]))).toEqual(meta.packages);
  });

  it("interactive → default all, returns the chosen subset", async () => {
    const prompt = fakePrompt(["Assets/Plugins/Sirenix"]);
    const result = await selectStagedPackages(meta, false, prompt);

    expect(prompt.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialValues: [
          "Assets/vFolders",
          "Assets/Plugins/Sirenix",
          "Packages/Foo",
          "Assets/Foo",
        ],
        options: expect.arrayContaining([
          expect.objectContaining({ value: "Assets/Plugins/Sirenix", label: "Odin Inspector" }),
          expect.objectContaining({ value: "Packages/Foo", label: "Foo (Packages/Foo)" }),
          expect.objectContaining({ value: "Assets/Foo", label: "Foo (Assets/Foo)" }),
        ]),
      }),
    );
    expect(result).toEqual([{ label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 2 }]);
  });

  it("preselected relPaths skip the prompt entirely", async () => {
    const prompt = fakePrompt([]);
    const result = await selectStagedPackages(meta, false, prompt, ["Assets/vFolders"]);

    expect(prompt.multiselect).not.toHaveBeenCalled();
    expect(result).toEqual([{ label: "vFolders", relPath: "Assets/vFolders", bytes: 1 }]);
  });
});

describe("selectStagedPackagesToRemove — remove side", () => {
  it("nothing preselected — the user opts each removal in", async () => {
    const prompt = fakePrompt(["Assets/vFolders"]);
    const result = await selectStagedPackagesToRemove(meta, prompt);

    expect(prompt.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({ initialValues: [] }),
    );
    expect(result).toEqual([{ label: "vFolders", relPath: "Assets/vFolders", bytes: 1 }]);
  });

  it("preselected relPaths skip the prompt entirely", async () => {
    const prompt = fakePrompt([]);
    const result = await selectStagedPackagesToRemove(meta, prompt, ["Assets/Plugins/Sirenix"]);

    expect(prompt.multiselect).not.toHaveBeenCalled();
    expect(result).toEqual([{ label: "Odin Inspector", relPath: "Assets/Plugins/Sirenix", bytes: 2 }]);
  });
});
