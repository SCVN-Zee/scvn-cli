/**
 * test/lib/markers.test.ts
 *
 * Ported from fork-unity-setup. Import paths updated to scvn src/.
 */

import { describe, expect, it } from "vitest";
import { replaceMarkerBlock, stripMarkerBlock } from "../../src/lib/markers.js";

describe("replaceMarkerBlock", () => {
  it("appends when absent (empty)", () => {
    const out = replaceMarkerBlock("", "content");
    expect(out).toContain("# BEGIN fork-unity-setup");
    expect(out).toContain("content");
    expect(out).toContain("# END fork-unity-setup");
  });

  it("appends and preserves existing content", () => {
    const existing = "*.cs text\n";
    const out = replaceMarkerBlock(existing, "INNER");
    expect(out.startsWith("*.cs text\n")).toBe(true);
    expect(out).toContain("# BEGIN fork-unity-setup\nINNER\n# END fork-unity-setup");
  });

  it("replaces existing marker block, keeps outer content", () => {
    const first = replaceMarkerBlock("pre\n", "A");
    const second = replaceMarkerBlock(first, "B");
    expect(second).toContain("# BEGIN fork-unity-setup\nB\n# END fork-unity-setup");
    expect(second).not.toContain("\nA\n");
    expect(second).toContain("pre\n");
    expect(second.match(/# BEGIN fork-unity-setup/g)?.length).toBe(1);
    expect(second.match(/# END fork-unity-setup/g)?.length).toBe(1);
  });

  it("is idempotent", () => {
    const a = replaceMarkerBlock("", "X");
    const b = replaceMarkerBlock(a, "X");
    expect(a).toBe(b);
  });

  it("throws on orphan BEGIN marker (no END)", () => {
    const bad = "pre\n# BEGIN fork-unity-setup\norphan\n";
    expect(() => replaceMarkerBlock(bad, "X")).toThrow(/Unbalanced/);
  });

  it("throws on orphan END marker (no BEGIN)", () => {
    const bad = "pre\n# END fork-unity-setup\n";
    expect(() => replaceMarkerBlock(bad, "X")).toThrow(/Unbalanced/);
  });

  it("throws on multiple paired blocks", () => {
    const once = replaceMarkerBlock("", "A");
    const twice = replaceMarkerBlock(once + "extra\n", "B");
    const twoBlocks = twice + "\n" + once;
    expect(() => replaceMarkerBlock(twoBlocks, "C")).toThrow(/Multiple/);
  });
});

describe("replaceMarkerBlock — custom marker pair (coexistence)", () => {
  const LFS = { begin: "# BEGIN scvn-lfs", end: "# END scvn-lfs" };

  it("inserts a block with the custom pair, not the fork markers", () => {
    const out = replaceMarkerBlock("", "LFSCONTENT", LFS);
    expect(out).toContain("# BEGIN scvn-lfs\nLFSCONTENT\n# END scvn-lfs");
    expect(out).not.toContain("# BEGIN fork-unity-setup");
  });

  it("replaces only the custom-pair block on re-run", () => {
    const first = replaceMarkerBlock("", "A", LFS);
    const second = replaceMarkerBlock(first, "B", LFS);
    expect(second).toContain("# BEGIN scvn-lfs\nB\n# END scvn-lfs");
    expect(second).not.toContain("\nA\n");
    expect(second.match(/# BEGIN scvn-lfs/g)?.length).toBe(1);
  });

  it("keeps a fork block and an LFS block independent in one file", () => {
    // Seed a fork block over user content, then add an LFS block.
    let text = replaceMarkerBlock("*.cs text\n", "FORK");
    text = replaceMarkerBlock(text, "LFS", LFS);
    expect(text).toContain("# BEGIN fork-unity-setup\nFORK\n# END fork-unity-setup");
    expect(text).toContain("# BEGIN scvn-lfs\nLFS\n# END scvn-lfs");

    // Replacing the fork block leaves the LFS block untouched...
    const forkReplaced = replaceMarkerBlock(text, "FORK2");
    expect(forkReplaced).toContain("# BEGIN fork-unity-setup\nFORK2\n# END fork-unity-setup");
    expect(forkReplaced).toContain("# BEGIN scvn-lfs\nLFS\n# END scvn-lfs");

    // ...and replacing the LFS block leaves the fork block untouched.
    const lfsReplaced = replaceMarkerBlock(text, "LFS2", LFS);
    expect(lfsReplaced).toContain("# BEGIN scvn-lfs\nLFS2\n# END scvn-lfs");
    expect(lfsReplaced).toContain("# BEGIN fork-unity-setup\nFORK\n# END fork-unity-setup");
  });
});

describe("stripMarkerBlock", () => {
  const SCVN = { begin: "# >>> scvn >>>", end: "# <<< scvn <<<" };
  const MCP = { begin: "# >>> scvn mcp >>>", end: "# <<< scvn mcp <<<" };

  it("removes a balanced block and keeps the surrounding text", () => {
    const text = "pre\n# >>> scvn >>>\nbody\n# <<< scvn <<<\npost\n";
    expect(stripMarkerBlock(text, SCVN)).toBe("pre\npost\n");
  });

  it("is a no-op when the pair is absent", () => {
    const text = "just user lines\nbuild/\n";
    expect(stripMarkerBlock(text, SCVN)).toBe(text);
  });

  it("leaves a different marker pair untouched", () => {
    const text =
      "# >>> scvn mcp >>>\n/Assets/UnityMCP\n# <<< scvn mcp <<<\n" +
      "# >>> scvn >>>\nbody\n# <<< scvn <<<\n";
    const out = stripMarkerBlock(text, SCVN);
    expect(out).toBe("# >>> scvn mcp >>>\n/Assets/UnityMCP\n# <<< scvn mcp <<<\n");
    expect(stripMarkerBlock(out, MCP)).toBe("");
  });

  it("is idempotent", () => {
    const text = "pre\n# >>> scvn >>>\nbody\n# <<< scvn <<<\n";
    const once = stripMarkerBlock(text, SCVN);
    expect(stripMarkerBlock(once, SCVN)).toBe(once);
  });

  it("removes every balanced block rather than throwing (forgiving vs replace)", () => {
    const text = "# >>> scvn >>>\nA\n# <<< scvn <<<\nkeep\n# >>> scvn >>>\nB\n# <<< scvn <<<\n";
    expect(stripMarkerBlock(text, SCVN)).toBe("keep\n");
  });

  it("leaves an orphan marker in place (nothing balanced to remove)", () => {
    const text = "pre\n# >>> scvn >>>\norphan\n";
    expect(stripMarkerBlock(text, SCVN)).toBe(text);
  });

  it("defaults to the fork marker pair", () => {
    const text = replaceMarkerBlock("pre\n", "FORK");
    expect(stripMarkerBlock(text)).toBe("pre\n\n");
  });
});
