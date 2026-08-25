/**
 * features/mcp/invoke-setup-mcp.ts — Have unity-mcp-cli write the project's .mcp.json.
 *
 * Run through `process.execPath` — the very Node already running scvn, which in
 * a delivered bundle is the bundled runtime. Never `npx` (needs a registry),
 * never a bare `node` (needs one on PATH). That is what makes this work on an
 * artist's Mac with no Node install and no network.
 *
 * scvn does not write `.mcp.json` itself because it CANNOT: the file carries a
 * per-project MCP port whose derivation was investigated and empirically refuted
 * (two different paths resolve to the same port). Guessing it wrong would produce
 * a silently dead connection, so the real tool does it.
 *
 * A non-zero exit WARNS rather than fails: by this point the vendoring has
 * already completed, and `.mcp.json` is the one re-runnable part.
 */

import { execa } from "execa";
import { resolveUnityMcpCliDir, cliEntryPath } from "./resolve-mcp-cache.js";
import type { SyncReporter } from "../transfer/reporter.js";

export interface InvokeSetupMcpOpts {
  /** The Unity project dir (parent of Assets/) — NOT the git repo root. */
  unityProjectDir: string;
  /** CLI version to invoke (pairs with the installed core). */
  cliVersion: string;
  /** User cache root; the bundled cache is the fallback. */
  cacheDir: string;
  dryRun?: boolean;
  reporter?: Pick<SyncReporter, "onLog">;
  /** Injectable runner (tests). */
  run?: (file: string, args: string[]) => Promise<{ exitCode: number | undefined; stderr?: string }>;
}

function log(opts: InvokeSetupMcpOpts, level: "info" | "warn", message: string): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

/** Write `.mcp.json` into the Unity project via the cached CLI. Never throws. */
export async function invokeSetupMcp(opts: InvokeSetupMcpOpts): Promise<boolean> {
  const cached = await resolveUnityMcpCliDir(opts.cliVersion, { userCacheDir: opts.cacheDir });

  if (cached === null) {
    log(
      opts,
      "warn",
      `unity-mcp-cli@${opts.cliVersion} is not cached — .mcp.json not written. ` +
        `The vendored source is installed; re-run \`scvn mcp install\` online to finish.`,
    );
    return false;
  }

  const entry = cliEntryPath(cached.dir);
  const args = [entry, "setup-mcp", "claude-code", opts.unityProjectDir];

  if (opts.dryRun) {
    log(opts, "info", `[dry-run] ${process.execPath} ${args.join(" ")}`);
    return true;
  }

  const runner =
    opts.run ??
    ((file: string, argv: string[]) => execa(file, argv, { reject: false, stdio: "pipe" }));

  const result = await runner(process.execPath, args);
  if (result.exitCode !== 0) {
    log(
      opts,
      "warn",
      `setup-mcp exited ${result.exitCode} — .mcp.json may not be written. ` +
        `${result.stderr?.trim() ?? ""}`.trim(),
    );
    return false;
  }

  log(opts, "info", ".mcp.json written by unity-mcp-cli");
  return true;
}
