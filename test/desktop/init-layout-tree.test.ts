import { describe, expect, it } from "vitest";
import {
  buildInitLayoutTree,
  removeInitTreePath,
  renameInitTreePath,
} from "../../desktop/renderer/lib/init-layout-tree.js";

describe("initializer hierarchy tree", () => {
  it("groups paths while preserving explicit parent entries", () => {
    const tree = buildInitLayoutTree(["Animation", "Animation/Clips", "Animation/Controllers", "Scenes"]);
    expect(tree.map((node) => node.name)).toEqual(["Animation", "Scenes"]);
    expect(tree[0]?.explicit).toBe(true);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(["Clips", "Controllers"]);
  });

  it("renames a node and all descendant paths without changing order", () => {
    expect(renameInitTreePath(["Audio", "Audio/SFXx", "Audio/BGMs", "Scenes"], "Audio", "Sound"))
      .toEqual(["Sound", "Sound/SFXx", "Sound/BGMs", "Scenes"]);
  });

  it("removes a complete subtree", () => {
    expect(removeInitTreePath(["Audio", "Audio/SFXx", "Audio/BGMs", "Scenes"], "Audio"))
      .toEqual(["Scenes"]);
  });
});
