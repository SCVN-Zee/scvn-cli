/**
 * features/setup/setup-gitexclude.ts — Install the bundled exclude template into
 * the repo's `.git/info/exclude` as a fenced block.
 *
 * `info/exclude` is shared with the vendored-MCP block and whatever the
 * developer hand-wrote, so the template is fenced rather than copied over the
 * file (which is what the generic rsync template path used to do — see
 * setup-templates.ts, which no longer handles this key).
 *
 * Reporter status contract (consumed by the step-runner), matching setup-lfs:
 *   - no git repo → "skipped", not a failure
 *   - dryRun      → "done" with a "would …" detail, no writes
 *   - unchanged   → "skipped" ("up to date")
 *   - applied     → "done"
 */

import path from "node:path";
import { readFile } from "node:fs/promises";
import { getRepoRoot, getGitInfoExcludePath } from "../../services/git.js";
import { hashFile } from "../../util/file-compare.js";
import { resolveTemplateKey } from "../../util/template-paths.js";
import { applyExcludeBlock, SCVN_FENCE } from "../../lib/exclude-block.js";
import type { SyncReporter } from "../transfer/reporter.js";

/**
 * sha256 of each RETIRED `templates/git-exclude` revision. Before fencing, scvn
 * copied the template over `info/exclude` wholesale, so a file matching one of
 * these digests was written by scvn and contains nothing else — it is safe to
 * replace outright with the fenced form. The CURRENT revision is hashed at
 * runtime and checked alongside these.
 *
 * Append the outgoing digest here whenever `templates/git-exclude` changes.
 * Skipping that strands the old body outside the fence, where no later run can
 * refresh or remove it: the v0.5 revision's `UnityMcp**` line would go on
 * matching `Assets/UnityMCP` (git defaults to case-insensitive on macOS) even
 * after `scvn mcp uninstall` strips the mcp fence.
 *
 * Exact-byte matching is what keeps a wholesale replace safe — a hand-edited
 * file never matches, so it always takes the additive path.
 */
const RETIRED_TEMPLATE_DIGESTS: readonly string[] = [
  // v0.5 — the v0.5.1 pre-trim body (below) plus a `UnityMcp**` line.
  "b76ab88e734724934fb56f7481b28166bd05872b0955d765302e50ae1f560beb",
  // v0.5.1 — pre-trim revision (vPlugins / Others / docs-plans sections),
  // retired when templates/git-exclude was trimmed to lean defaults.
  "a9239c21d02d2c8cf9801a1d3110ab04e6df6584d55677d2a8628444f62803a8",
];

export interface SetupGitexcludeOpts {
  dryRun?:  boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

/** True when `excludePath` holds an unfenced copy of some scvn template revision. */
async function isPreFenceTemplate(
  excludePath: string,
  templatePath: string,
): Promise<boolean> {
  const excludeDigest = await hashFile(excludePath);
  if (excludeDigest === null) return false;
  if (RETIRED_TEMPLATE_DIGESTS.includes(excludeDigest)) return true;
  return excludeDigest === (await hashFile(templatePath));
}

export async function setupGitexclude(
  target: string,
  opts: SetupGitexcludeOpts = {},
): Promise<void> {
  const dryRun   = opts.dryRun ?? false;
  const reporter = opts.reporter;

  reporter?.onStatus({ status: "running" });

  try {
    const repoRoot = await getRepoRoot(target);
    if (!repoRoot) {
      reporter?.onStatus({ status: "skipped", detail: "no git repo" });
      return;
    }
    const excludePath = await getGitInfoExcludePath(repoRoot);
    if (!excludePath) {
      reporter?.onStatus({ status: "skipped", detail: "no git repo" });
      return;
    }

    const templatePath = await resolveTemplateKey("gitexclude");
    // Trailing newlines would open a blank line before the closing marker.
    const inner = (await readFile(templatePath, "utf8")).replace(/\n+$/, "");

    // A file that is verbatim some template revision predates fencing and holds
    // nothing but scvn's own lines — rewrite it fenced instead of appending a
    // second copy. Anything else takes the additive path, which never removes
    // bytes it did not write.
    const isPreFence = await isPreFenceTemplate(excludePath, templatePath);

    if (dryRun) {
      reporter?.onStatus({
        status: "done",
        detail: `would write the scvn block into ${path.relative(repoRoot, excludePath)}`,
      });
      return;
    }

    const { written } = await applyExcludeBlock(
      excludePath,
      inner,
      SCVN_FENCE,
      isPreFence ? { baseText: "" } : {},
    );

    reporter?.onStatus(
      written
        ? { status: "done", detail: "git-exclude synced" }
        : { status: "skipped", detail: "up to date" },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    reporter?.onStatus({ status: "failed", error: message });
    throw err;
  }
}
