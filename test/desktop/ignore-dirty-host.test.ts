/**
 * test/desktop/ignore-dirty-host.test.ts — Host handlers for the Ignore-dirty
 * page, exercised against a REAL temporary git repo (no mocking).
 *
 * A submodule is declared purely by its tracked `.gitmodules` entry (git reads
 * the list and the `ignore =` fallback from that file — no working-tree checkout
 * is needed). This proves end-to-end that:
 *   - list joins each submodule's local `.git/config` override with its
 *     `.gitmodules` fallback, keyed on the section NAME;
 *   - set writes/clears ONLY the repo-local override (never `.gitmodules`), and
 *     a subsequent list reflects it;
 *   - a name != path submodule keys the local write on its NAME.
 */

import { describe, it, expect } from "vitest";
import { execa } from "execa";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "../helpers/tmp-dir.js";
import { ignoreDirtyList, ignoreDirtySet } from "../../desktop/host/ignore-dirty.js";
import { getLocalConfig } from "../../src/services/git.js";
import type { SubmoduleIgnoreList } from "../../desktop/shared/commands.js";

/** A git repo whose `.gitmodules` declares two submodules (one with a baked-in ignore=dirty). */
async function repoWithSubmodules(): Promise<string> {
  const dir = await tmpDir("scvn-ignore-dirty-");
  await execa("git", ["init", "-q"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "scvn-test"], { cwd: dir });
  await writeFile(
    path.join(dir, ".gitmodules"),
    [
      '[submodule "Plugins"]',
      "\tpath = Plugins",
      "\turl = ../plugins.git",
      // name != path, and .gitmodules already forces ignore=dirty
      '[submodule "vendored"]',
      "\tpath = Third/Vendored",
      "\turl = ../vendored.git",
      "\tignore = dirty",
      "",
    ].join("\n"),
  );
  return dir;
}

function rows(list: SubmoduleIgnoreList) {
  if (list.status !== "ok") throw new Error(`expected ok, got ${list.status}`);
  return Object.fromEntries(list.submodules.map((s) => [s.name, s]));
}

describe("ignore-dirty host handlers", () => {
  it("list joins .gitmodules entries with local overrides and the gitmodules fallback", async () => {
    const repo = await repoWithSubmodules();
    const list = (await ignoreDirtyList(null, { target: repo })) as SubmoduleIgnoreList;
    const byName = rows(list);

    expect(byName["Plugins"]).toEqual({
      name: "Plugins",
      path: "Plugins",
      localDirty: false,
      gitmodulesIgnore: null,
    });
    expect(byName["vendored"]).toEqual({
      name: "vendored",
      path: "Third/Vendored",
      localDirty: false, // no LOCAL override yet …
      gitmodulesIgnore: "dirty", // … but .gitmodules already ignores dirty (surfaced read-only)
    });
  });

  it("set writes the local override (keyed on name) and a re-list reflects it", async () => {
    const repo = await repoWithSubmodules();

    expect(await ignoreDirtySet(null, { target: repo, name: "Plugins", ignored: true })).toEqual({
      localDirty: true,
    });
    expect(await getLocalConfig(repo, "submodule.Plugins.ignore")).toBe("dirty");
    expect(rows((await ignoreDirtyList(null, { target: repo })) as SubmoduleIgnoreList)["Plugins"]!.localDirty).toBe(true);

    // Toggling off unsets the local key entirely.
    expect(await ignoreDirtySet(null, { target: repo, name: "Plugins", ignored: false })).toEqual({
      localDirty: false,
    });
    expect(await getLocalConfig(repo, "submodule.Plugins.ignore")).toBeNull();
  });

  it("keys the local write on the submodule NAME, not its path", async () => {
    const repo = await repoWithSubmodules();
    await ignoreDirtySet(null, { target: repo, name: "vendored", ignored: true });
    // Written under the NAME "vendored", never the path "Third/Vendored".
    expect(await getLocalConfig(repo, "submodule.vendored.ignore")).toBe("dirty");
    expect(await getLocalConfig(repo, "submodule.Third/Vendored.ignore")).toBeNull();
  });

  it("reports notRepo for a non-git target", async () => {
    const plain = await tmpDir("scvn-ignore-dirty-plain-");
    const list = (await ignoreDirtyList(null, { target: plain })) as SubmoduleIgnoreList;
    expect(list).toEqual({ status: "notRepo", target: plain });
  });

  it("reports noSubmodules for a repo without .gitmodules", async () => {
    const dir = await tmpDir("scvn-ignore-dirty-bare-");
    await execa("git", ["init", "-q"], { cwd: dir });
    const list = (await ignoreDirtyList(null, { target: dir })) as SubmoduleIgnoreList;
    expect(list.status).toBe("noSubmodules");
  });
});
