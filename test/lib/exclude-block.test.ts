/**
 * test/lib/exclude-block.test.ts — Integration tests for the fenced
 * `.git/info/exclude` writer, against real files in a temp dir.
 *
 * The bug this guards: a wholesale file→file copy destroys any foreign block in
 * `info/exclude` (hand-written lines, the MCP fence). Every case here asserts
 * foreign bytes survive.
 */

import { describe, it, expect } from "vitest";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import {
  applyExcludeBlock,
  stripExcludeBlock,
  SCVN_FENCE,
  SCVN_MCP_FENCE,
} from "../../src/lib/exclude-block.js";

const BODY = "vFolders**\ndocs\n";
const INNER = BODY.trimEnd();

const MCP_BLOCK =
  "# >>> scvn mcp >>>\n/Assets/UnityMCP\n# <<< scvn mcp <<<\n";

/** Write an existing `info/exclude` with the given bytes. */
async function seed(dir: string, content: string): Promise<string> {
  const file = path.join(dir, "info", "exclude");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("applyExcludeBlock", () => {
  it("creates a fenced file (and its parent dirs) when none exists", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = path.join(dir, "info", "exclude");

    const result = await applyExcludeBlock(file, INNER, SCVN_FENCE);

    expect(result.written).toBe(true);
    expect(await readFile(file, "utf8")).toBe(
      `# >>> scvn >>>\n${INNER}\n# <<< scvn <<<\n`,
    );
  });

  it("appends after hand-written lines that lack a trailing newline, un-fused", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "# user line\nbuild/"); // no trailing \n

    await applyExcludeBlock(file, INNER, SCVN_FENCE);
    const text = await readFile(file, "utf8");

    expect(text).toContain("# user line\nbuild/\n");
    expect(text).not.toContain("build/# >>> scvn >>>");
    expect(count(text, "# >>> scvn >>>")).toBe(1);
  });

  it("is idempotent — a second apply leaves exactly one fence", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "# user line\n");

    await applyExcludeBlock(file, INNER, SCVN_FENCE);
    const first = await readFile(file, "utf8");
    const second = await applyExcludeBlock(file, INNER, SCVN_FENCE);

    expect(second.written).toBe(false);
    expect(await readFile(file, "utf8")).toBe(first);
    expect(count(first, "# >>> scvn >>>")).toBe(1);
  });

  it("refreshes the fence body in place without moving foreign lines", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "keep-me\n");

    await applyExcludeBlock(file, "OLD", SCVN_FENCE);
    await applyExcludeBlock(file, "NEW", SCVN_FENCE);
    const text = await readFile(file, "utf8");

    expect(text).toContain("keep-me\n");
    expect(text).toContain("# >>> scvn >>>\nNEW\n# <<< scvn <<<");
    expect(text).not.toContain("OLD");
  });

  it("leaves a foreign mcp fence byte-identical", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, MCP_BLOCK);

    await applyExcludeBlock(file, INNER, SCVN_FENCE);
    const text = await readFile(file, "utf8");

    expect(text).toContain(MCP_BLOCK);
    expect(count(text, "# >>> scvn mcp >>>")).toBe(1);
    expect(count(text, "# >>> scvn >>>")).toBe(1);
  });

  it("baseText:'' discards the current file — the migration path", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "legacy-template-line\n");

    const result = await applyExcludeBlock(file, INNER, SCVN_FENCE, { baseText: "" });

    expect(result.written).toBe(true);
    expect(await readFile(file, "utf8")).toBe(
      `# >>> scvn >>>\n${INNER}\n# <<< scvn <<<\n`,
    );
  });

  it("writes each fence independently into one file", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = path.join(dir, "exclude");

    await applyExcludeBlock(file, INNER, SCVN_FENCE);
    await applyExcludeBlock(file, "/Assets/UnityMCP", SCVN_MCP_FENCE);
    const text = await readFile(file, "utf8");

    expect(text).toContain(`# >>> scvn >>>\n${INNER}\n# <<< scvn <<<`);
    expect(text).toContain("# >>> scvn mcp >>>\n/Assets/UnityMCP\n# <<< scvn mcp <<<");
  });

  it("throws on an orphan fence rather than silently swallowing content", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "# >>> scvn >>>\ncrash residue\n");

    await expect(applyExcludeBlock(file, INNER, SCVN_FENCE)).rejects.toThrow(/Unbalanced/);
  });

  it("leaves no temp file behind", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = path.join(dir, "exclude");

    await applyExcludeBlock(file, INNER, SCVN_FENCE);

    expect(await readdir(dir)).toEqual(["exclude"]);
  });
});

describe("stripExcludeBlock", () => {
  it("removes only the scvn fence, sparing foreign lines and the mcp fence", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, `hand-written\n${MCP_BLOCK}`);
    await applyExcludeBlock(file, INNER, SCVN_FENCE);

    const result = await stripExcludeBlock(file, SCVN_FENCE);
    const text = await readFile(file, "utf8");

    expect(result.written).toBe(true);
    expect(text).toContain("hand-written\n");
    expect(text).toContain(MCP_BLOCK);
    expect(text).not.toContain("# >>> scvn >>>");
  });

  it("is a no-op when the fence is absent", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = await seed(dir, "hand-written\n");

    const result = await stripExcludeBlock(file, SCVN_FENCE);

    expect(result.written).toBe(false);
    expect(await readFile(file, "utf8")).toBe("hand-written\n");
  });

  it("never creates a missing file", async () => {
    const dir = await tmpDir("scvn-excl-");
    const file = path.join(dir, "info", "exclude");

    const result = await stripExcludeBlock(file, SCVN_FENCE);

    expect(result.written).toBe(false);
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});
