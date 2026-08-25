/**
 * features/setup/setup-templates.ts — Sync .gitignore.
 *
 * Two entry points:
 *   setupTemplate(target, key, opts)  → single template sync
 *   setupTemplates(target, keys?, opts) → multi-key batch wrapper
 *
 * Key: gitignore — a whole-file template the target owns outright.
 * `gitexclude` is NOT one: `.git/info/exclude` is shared with other block
 * writers, so it gets a fenced handler of its own (setup-gitexclude.ts).
 *
 * opts.onLog    — informational log lines
 * opts.onStatus — step status updates (running / done / skipped / failed)
 * opts.dryRun   — preview only, no writes
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { rsyncCopy } from "../../services/rsync.js";
import { getRepoRoot } from "../../services/git.js";
import { compareFiles } from "../../util/file-compare.js";
import { resolveTemplateKey, templateFilename } from "../../util/template-paths.js";
import type { TemplateKey } from "../../util/template-paths.js";
import type { SyncReporter } from "../transfer/reporter.js";

/**
 * The template keys this module copies wholesale. Excludes the block-source
 * templates: `gitexclude` (fenced into .git/info/exclude — see the header),
 * `gitattributesMerge` (inserted into the fork marker block by
 * writers/write-gitattributes.ts, never copied over the file), and
 * `gitattributesLfs` (inserted into the LFS marker block by
 * writers/write-lfs-attributes.ts, likewise never copied).
 */
export type SetupTemplateKey = Exclude<
  TemplateKey,
  "gitexclude" | "gitattributesMerge" | "gitattributesLfs"
>;

// ---------------------------------------------------------------------------
// Options seam — replaces useStore coupling
// ---------------------------------------------------------------------------

export interface SetupTemplateOpts {
  dryRun?:  boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveTargetPath(
  key: SetupTemplateKey,
  unityRoot: string,
  gitRoot: string | null
): string {
  switch (key) {
    // .gitignore is a git artifact → the repo root. Fall back to the Unity
    // project root only when the target is not inside a git repository.
    case "gitignore":    return path.join(gitRoot ?? unityRoot, ".gitignore");
  }
}

// ---------------------------------------------------------------------------
// Single-template entry point
// ---------------------------------------------------------------------------

/** Sync a single bundled template to the target project. Up-to-date files emit status:"skipped". */
export async function setupTemplate(
  target: string,
  key: SetupTemplateKey,
  opts: SetupTemplateOpts = {},
): Promise<void> {
  const dryRun   = opts.dryRun  ?? false;
  const reporter = opts.reporter;

  reporter?.onStatus({ status: "running" });

  try {
    const sourcePath      = await resolveTemplateKey(key);
    const unityRoot       = path.dirname(target);
    const gitRoot         = await getRepoRoot(target);
    const destinationPath = resolveTargetPath(key, unityRoot, gitRoot);

    const comparison = await compareFiles(sourcePath, destinationPath);
    if (comparison.isUpToDate) {
      reporter?.onStatus({ status: "skipped", detail: "up to date" });
      return;
    }

    if (!dryRun) {
      await mkdir(path.dirname(destinationPath), { recursive: true });
    }
    await rsyncCopy(sourcePath, destinationPath, { dryRun });

    reporter?.onStatus({
      status: "done",
      detail: `${templateFilename(key)} synced`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    reporter?.onStatus({ status: "failed", error: message });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Batch entry point
// ---------------------------------------------------------------------------

/**
 * Batch wrapper — calls setupTemplate sequentially for each key.
 * Failures in one key do not abort the rest.
 */
export async function setupTemplates(
  target: string,
  keys: SetupTemplateKey[] = ["gitignore"],
  opts: SetupTemplateOpts = {},
): Promise<void> {
  for (const key of keys) {
    await setupTemplate(target, key, opts).catch(() => { /* non-fatal */ });
  }
}
