/**
 * test/features/setup-gitexclude.test.ts — Integration tests for setupGitexclude.
 *
 * Real git repos, real bundled template, real writes. The previous
 * implementation rsync'd the template over `info/exclude` wholesale, silently
 * destroying the vendored-MCP block and any hand-written lines; the
 * "preserves foreign" cases below are the regression guard for that data loss.
 */

import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpDir } from "../helpers/tmp-dir.js";
import { setupGitexclude } from "../../src/features/setup/setup-gitexclude.js";
import { getGitInfoExcludePath } from "../../src/services/git.js";
import { resolveTemplateKey } from "../../src/util/template-paths.js";
import type { SyncStatusEvent } from "../../src/features/transfer/reporter.js";

const MCP_BLOCK = "# >>> scvn mcp >>>\n/Assets/UnityMCP\n# <<< scvn mcp <<<\n";

function fakeReporter() {
  const events: SyncStatusEvent[] = [];
  return {
    reporter: { onStatus: (e: SyncStatusEvent) => events.push(e), onLog: () => {} },
    last: () => events.at(-1),
  };
}

/** A git repo with a Unity-shaped `Assets/` dir; returns the target + exclude path. */
async function makeRepo(): Promise<{ target: string; excludePath: string }> {
  const dir = await tmpDir("scvn-gitexcl-");
  await execa("git", ["init", "-q"], { cwd: dir });
  const target = path.join(dir, "Assets");
  await mkdir(target, { recursive: true });
  const excludePath = await getGitInfoExcludePath(dir);
  return { target, excludePath: excludePath! };
}

async function templateBody(): Promise<string> {
  const file = await resolveTemplateKey("gitexclude");
  return (await readFile(file, "utf8")).replace(/\n+$/, "");
}

/**
 * A retired pre-fence template body, frozen as a fixture (so it survives future
 * template edits). `v0.5.1` is the pre-trim body verbatim; `v0.5` is that body
 * plus the `UnityMcp**` line the mcp path used before the mcp fence. Their
 * sha256s are the entries in RETIRED_TEMPLATE_DIGESTS.
 */
async function retiredBody(rev: "v0.5.1" | "v0.5"): Promise<string> {
  const file = fileURLToPath(new URL("../fixtures/git-exclude-v0.5.1.txt", import.meta.url));
  const base = await readFile(file, "utf8");
  return rev === "v0.5"
    ? base.replace("Voxel Labs**\n", "Voxel Labs**\nUnityMcp**\n")
    : base;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("setupGitexclude", () => {
  it("skips cleanly when the target is not inside a git repo", async () => {
    const dir = await tmpDir("scvn-gitexcl-nogit-");
    const { reporter, last } = fakeReporter();

    await setupGitexclude(dir, { reporter });

    expect(last()).toEqual({ status: "skipped", detail: "no git repo" });
  });

  it("dry-run writes nothing and reports what it would do", async () => {
    const { target, excludePath } = await makeRepo();
    const before = await readFile(excludePath, "utf8");
    const { reporter, last } = fakeReporter();

    await setupGitexclude(target, { dryRun: true, reporter });

    expect(await readFile(excludePath, "utf8")).toBe(before);
    expect(last()?.status).toBe("done");
    expect(last()?.detail).toMatch(/would/);
  });

  it("preserves hand-written lines and a foreign mcp fence", async () => {
    const { target, excludePath } = await makeRepo();
    await writeFile(excludePath, `# my notes\nbuild/\n${MCP_BLOCK}`, "utf8");
    const { reporter, last } = fakeReporter();

    await setupGitexclude(target, { reporter });
    const text = await readFile(excludePath, "utf8");

    expect(text).toContain("# my notes\nbuild/\n");
    expect(text).toContain(MCP_BLOCK);
    expect(text).toContain(`# >>> scvn >>>\n${await templateBody()}\n# <<< scvn <<<`);
    expect(last()?.status).toBe("done");
  });

  it("does not fuse the fence onto a last line lacking a trailing newline", async () => {
    const { target, excludePath } = await makeRepo();
    await writeFile(excludePath, "# user line\nbuild/", "utf8");

    await setupGitexclude(target, {});
    const text = await readFile(excludePath, "utf8");

    expect(text).toContain("build/\n");
    expect(text).not.toContain("build/# >>> scvn >>>");
  });

  it("migrates a byte-equal current template to the fenced form without duplicating it", async () => {
    const { target, excludePath } = await makeRepo();
    const templatePath = await resolveTemplateKey("gitexclude");
    await writeFile(excludePath, await readFile(templatePath, "utf8"), "utf8");

    await setupGitexclude(target, {});
    const text = await readFile(excludePath, "utf8");

    expect(text).toBe(`# >>> scvn >>>\n${await templateBody()}\n# <<< scvn <<<\n`);
    expect(count(text, ".mcp.json")).toBe(1);
    expect(count(text, "UnityMcp")).toBe(0);
  });

  it("migrates the retired v0.5.1 pre-trim revision to the fenced current form", async () => {
    // A pre-fence install carries a wholesale copy of whatever template its scvn
    // shipped. The v0.5.1 body (before the lean-defaults trim) must still be
    // recognized by digest, or it falls to the additive path and strands the old
    // unfenced body forever.
    const { target, excludePath } = await makeRepo();
    await writeFile(excludePath, await retiredBody("v0.5.1"), "utf8");

    await setupGitexclude(target, {});
    const text = await readFile(excludePath, "utf8");

    // Exact-match proves wholesale replacement: an additive path would leave the
    // old body in place and this equality would fail.
    expect(text).toBe(`# >>> scvn >>>\n${await templateBody()}\n# <<< scvn <<<\n`);
    expect(count(text, "UnityMcp")).toBe(0);
  });

  it("migrates the retired v0.5 revision too, dropping its UnityMcp** line", async () => {
    // v0.5 = the v0.5.1 body plus a `UnityMcp**` line (the mcp path predating the
    // mcp fence). Left unrecognized, that line would keep matching Assets/UnityMCP
    // even after `scvn mcp uninstall`.
    const { target, excludePath } = await makeRepo();
    const v05 = await retiredBody("v0.5");
    expect(v05).toContain("UnityMcp**\n"); // guard: fixture carries the retired line
    await writeFile(excludePath, v05, "utf8");

    await setupGitexclude(target, {});
    const text = await readFile(excludePath, "utf8");

    expect(text).toBe(`# >>> scvn >>>\n${await templateBody()}\n# <<< scvn <<<\n`);
    expect(count(text, "UnityMcp")).toBe(0);
  });

  it("never wholesale-replaces a file that merely resembles a template revision", async () => {
    const { target, excludePath } = await makeRepo();
    const current = await readFile(await resolveTemplateKey("gitexclude"), "utf8");
    await writeFile(excludePath, `${current}# my own line\n`, "utf8");

    await setupGitexclude(target, {});
    const text = await readFile(excludePath, "utf8");

    expect(text).toContain("# my own line\n");
  });

  it("leaves exactly one fence when run twice, and reports the second run as up to date", async () => {
    const { target, excludePath } = await makeRepo();
    const { reporter, last } = fakeReporter();

    await setupGitexclude(target, {});
    const first = await readFile(excludePath, "utf8");
    await setupGitexclude(target, { reporter });

    expect(await readFile(excludePath, "utf8")).toBe(first);
    expect(count(first, "# >>> scvn >>>")).toBe(1);
    expect(last()?.status).toBe("skipped");
    expect(last()?.detail).toMatch(/up to date/);
  });

  it("writes the exclude file of a submodule, not a path under its gitlink", async () => {
    const dir = await tmpDir("scvn-gitexcl-submod-");
    const upstream = path.join(dir, "upstream");
    const superRepo = path.join(dir, "super");
    await mkdir(upstream, { recursive: true });
    await mkdir(superRepo, { recursive: true });
    for (const repo of [upstream, superRepo]) {
      await execa("git", ["init", "-q"], { cwd: repo });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await execa("git", ["config", "user.name", "scvn-test"], { cwd: repo });
    }
    await execa("git", ["commit", "-q", "--allow-empty", "-m", "init"], { cwd: upstream });
    await execa(
      "git",
      ["-c", "protocol.file.allow=always", "submodule", "add", "-q", upstream, "sub"],
      { cwd: superRepo },
    );
    const submodule = path.join(superRepo, "sub");
    await mkdir(path.join(submodule, "Assets"), { recursive: true });
    const { reporter, last } = fakeReporter();

    await setupGitexclude(path.join(submodule, "Assets"), { reporter });

    expect(last()?.status).toBe("done");
    const excludePath = (await getGitInfoExcludePath(submodule))!;
    expect(await readFile(excludePath, "utf8")).toContain("# >>> scvn >>>");
  });

  it("reports failure and rethrows when the exclude file is unwritable", async () => {
    const { target, excludePath } = await makeRepo();
    // Replace info/ with a file so the atomic write's mkdir fails (ENOTDIR).
    await rm(path.dirname(excludePath), { recursive: true, force: true });
    await writeFile(path.dirname(excludePath), "not a directory", "utf8");
    const { reporter, last } = fakeReporter();

    await expect(setupGitexclude(target, { reporter })).rejects.toThrow();
    expect(last()?.status).toBe("failed");
  });
});
