/**
 * test/desktop/package-tree.test.ts — Group staged packages by relPath.
 *
 * Pure: no DOM, no host. Pins the directory shape the Packages page renders
 * so Plugins/Sirenix and Supercent/Core stay distinct, nested folders collapse
 * independently, and a package that itself has nested packages is both a leaf
 * and a parent.
 */

import { describe, it, expect } from "vitest";
import {
  buildPackageTree,
  collectPackageRelPaths,
  allFolderPaths,
  splitRelPath,
} from "../../desktop/renderer/lib/package-tree.ts";

function pkg(label: string, relPath: string) {
  return { label, relPath };
}

describe("splitRelPath", () => {
  it("splits on forward slashes", () => {
    expect(splitRelPath("Plugins/Demigiant/DOTween")).toEqual([
      "Plugins",
      "Demigiant",
      "DOTween",
    ]);
  });

  it("splits on backslashes", () => {
    expect(splitRelPath("Plugins\\Sirenix")).toEqual(["Plugins", "Sirenix"]);
  });
});

describe("buildPackageTree", () => {
  it("returns an empty tree for no packages", () => {
    expect(buildPackageTree([])).toEqual([]);
  });

  it("keeps a top-level package at the root", () => {
    const tree = buildPackageTree([pkg("TextMesh Pro", "TextMesh Pro")]);
    expect(tree).toMatchObject([
      { name: "TextMesh Pro", path: "TextMesh Pro", pkg: { label: "TextMesh Pro" }, children: [] },
    ]);
  });

  it("groups nested packages under their Assets folders", () => {
    const tree = buildPackageTree([
      pkg("DOTween", "Plugins/Demigiant/DOTween"),
      pkg("Sirenix", "Plugins/Sirenix"),
      pkg("Core", "Supercent/Core"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["Plugins", "Supercent"]);
    const plugins = tree[0]!;
    expect(plugins.pkg).toBeUndefined();
    expect(plugins.children.map((n) => n.name)).toEqual(["Demigiant", "Sirenix"]);
    expect(plugins.children[0]!.children.map((n) => n.name)).toEqual(["DOTween"]);
    expect(plugins.children[1]!.pkg?.label).toBe("Sirenix");
    expect(tree[1]!.children[0]!.pkg?.label).toBe("Core");
  });

  it("treats a package with nested packages as both a leaf and a parent", () => {
    const tree = buildPackageTree([
      pkg("Feel", "Plugins/Feel"),
      pkg("MMFeedbacks", "Plugins/Feel/MMFeedbacks"),
    ]);
    const feel = tree[0]!.children[0]!;
    expect(feel.path).toBe("Plugins/Feel");
    expect(feel.pkg?.label).toBe("Feel");
    expect(feel.children).toHaveLength(1);
    expect(feel.children[0]!.pkg?.label).toBe("MMFeedbacks");
  });

  it("groups root-relative identities into Assets/, Packages/, and custom roots", () => {
    const tree = buildPackageTree([
      pkg("Sirenix", "Assets/Plugins/Sirenix"),
      pkg("com.acme.core", "Packages/com.acme.core"),
      pkg("SharedTools", "SharedTools"),
    ]);

    expect(tree.map((n) => n.name)).toEqual(["Assets", "Packages", "SharedTools"]);
    expect(tree[0]!.children[0]!.children[0]!.pkg?.label).toBe("Sirenix");
    expect(tree[1]!.children[0]!.pkg?.label).toBe("com.acme.core");
    expect(tree[2]!.pkg?.label).toBe("SharedTools");
  });

  it("sorts siblings alphabetically", () => {
    const tree = buildPackageTree([
      pkg("UI", "Supercent/UI"),
      pkg("Core", "Supercent/Core"),
      pkg("Ads", "Supercent/Ads"),
    ]);
    expect(tree[0]!.children.map((n) => n.name)).toEqual(["Ads", "Core", "UI"]);
  });
});

describe("collectPackageRelPaths / allFolderPaths", () => {
  const tree = buildPackageTree([
    pkg("Sirenix", "Plugins/Sirenix"),
    pkg("DOTween", "Plugins/Demigiant/DOTween"),
    pkg("Core", "Supercent/Core"),
    pkg("TMP", "TextMesh Pro"),
  ]);

  it("collects every descendant package under a folder", () => {
    const plugins = tree.find((n) => n.name === "Plugins")!;
    expect(collectPackageRelPaths(plugins).sort()).toEqual(["Plugins/Demigiant/DOTween", "Plugins/Sirenix"]);
  });

  it("expands nested folders without including leaf packages", () => {
    expect(allFolderPaths(tree)).toEqual(["Plugins", "Plugins/Demigiant", "Supercent"]);
  });
});
