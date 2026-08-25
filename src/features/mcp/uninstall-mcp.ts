/**
 * features/mcp/uninstall-mcp.ts — `scvn mcp uninstall`.
 *
 * Removes the vendored source and its exclude fence. Nothing was ever committed,
 * so there is nothing to revert — this is a pure on-disk removal.
 *
 * The NuGet DLLs are NOT removed by default. The plugin's own resolver restores
 * and prunes them, and other things may rely on them; `--purge-nuget` is the
 * explicit opt-in.
 *
 * Ports `cmd_uninstall` (unity-mcp-localize.sh:837).
 */

import path from "node:path";
import { rm, access } from "node:fs/promises";
import { getRepoRoot, getGitInfoExcludePath } from "../../services/git.js";
import { toRealPath } from "../../util/real-path.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import { stripExcludeBlock, SCVN_MCP_FENCE, LEGACY_MCP_FENCE } from "../../lib/exclude-block.js";
import { NUGET_SUBDIR } from "./mcp-constants.js";
import { importRoot } from "./marker.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface UninstallMcpOpts {
  /** The project's Assets dir. */
  target: string;
  /** Also remove Assets/Plugins/NuGet. */
  purgeNuget?: boolean;
  dryRun?: boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
}

function log(opts: UninstallMcpOpts, message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level: "info", message });
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Remove a dir and its Unity .meta sibling. */
async function removeWithMeta(dir: string, opts: UninstallMcpOpts): Promise<void> {
  if (opts.dryRun) {
    log(opts, `[dry-run] would remove ${dir} (+ .meta)`);
    return;
  }
  await rm(dir, { recursive: true, force: true });
  await rm(`${dir}.meta`, { force: true });
}

export async function uninstallMcp(opts: UninstallMcpOpts): Promise<void> {
  // Symlink-resolve so the fence strip targets the same repo git reports.
  const target = await toRealPath(opts.target);
  await assertUnityAssetsDir(target);
  const unityProjectDir = path.dirname(target);
  const dest = importRoot(unityProjectDir);

  if (await exists(dest)) {
    await removeWithMeta(dest, opts);
    log(opts, `removed ${path.relative(unityProjectDir, dest)} (+ .meta)`);
  } else {
    log(opts, "vendored source not present — nothing to remove");
  }

  if (opts.purgeNuget) {
    // Unity's NuGet resolver creates this, not scvn — an absent dir is a no-op.
    await removeWithMeta(path.join(unityProjectDir, NUGET_SUBDIR), opts);
    log(opts, `purged ${NUGET_SUBDIR} (+ .meta)`);
  }

  // Drop our fence — and the retired script's, so uninstalling a repo it wired
  // does not leave its patterns behind, still ignoring a directory that is gone.
  const repoRoot = await getRepoRoot(target);
  const excludePath = repoRoot ? await getGitInfoExcludePath(repoRoot) : null;
  if (excludePath !== null) {
    if (opts.dryRun) {
      log(opts, `[dry-run] would strip the mcp fence from ${excludePath}`);
    } else {
      await stripExcludeBlock(excludePath, SCVN_MCP_FENCE);
      await stripExcludeBlock(excludePath, LEGACY_MCP_FENCE);
      log(opts, "stripped the mcp fence from .git/info/exclude");
    }
  }

  opts.reporter?.onStatus({
    status: "done",
    detail: opts.dryRun ? "would uninstall MCP" : "MCP uninstalled (nothing was ever committed)",
  });
}
