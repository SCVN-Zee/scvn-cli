/**
 * commands/first-run-guard.ts — Startup config guard for SCVN_PROJECTS_ROOT.
 *
 * Runs once at CLI entry (after migrate + argv parse, before dispatch). When the
 * requested invocation needs the Unity projects root and the config is missing /
 * unset / points to a non-existent directory:
 *   - interactive TTY → launch `scvn config` (the ONLY writer of ~/.scvn/config),
 *     reload, re-validate once, then CONTINUE the original command (or fail if
 *     still unset — never loops the editor);
 *   - `-y` / non-TTY → hard-fail (exit 1) with a hint (cannot open an editor).
 *
 * Invocations that don't need the root — config/doctor/help/--version, the
 * migration hints, unknown/bare, and any run with an explicit --from/--to/--target
 * — skip the guard entirely (so the teammate `scvn import --to X` flow still runs
 * on an empty config).
 */

import process from "node:process";
import { stat } from "node:fs/promises";
import { resolveProjectsRoot, MISSING_PROJECTS_ROOT_MESSAGE } from "./shared/project-discovery.js";
import { runConfig as realRunConfig } from "./config.js";
import { realOutput } from "../ui/output.js";
import { ConfigRequiredError } from "../ui/errors.js";

/**
 * Direct bootstrap-op commands (shared with cli.tsx dispatch).
 * `gitignore` / `gitexclude` were grouped under `scvn git` in v0.5 — they now
 * route to a migration hint, not to runSetupOp.
 */
export const SETUP_OPS: Record<string, true> = {
  "ignore-dirty": true,
};

/** The parsed invocation shape the predicate needs. */
export interface Invocation {
  /** Resolved namespace (packages/sync/setup/config/doctor) or null. */
  namespace: string | null;
  /** Positional subcommand tokens (verb / op / "fork" / trailing args). */
  subcommands: string[];
  hasFrom: boolean;
  hasTo: boolean;
  /** --target flag OR SCVN_TARGET env present. */
  hasTarget: boolean;
  /** At least one `scvn git` op flag (--ignore/--exclude/--lfs) present. */
  hasGitOp?: boolean;
  /** --yes / -y promptless mode. */
  autoYes: boolean;
}

/**
 * Whether this invocation will reach an interactive project picker and thus
 * needs SCVN_PROJECTS_ROOT. Returns false for invocations that dispatch will
 * reject as usage errors (unknown verbs, trailing args, bare-noun-under-`-y`)
 * and for the migration-hint namespaces — so those keep producing their own
 * specific errors rather than the config hint. Explicit flags short-circuit the
 * picker, so they also make the root unnecessary.
 */
export function needsProjectsRoot(inv: Invocation): boolean {
  const { namespace: ns, autoYes } = inv;
  const subs = inv.subcommands;
  const s = subs[0] ?? "";

  // Migration-hint namespaces (and the bare `all` alias → sync) never need the root.
  if (ns === "sync" || ns === "setup") return false;

  if (ns === "packages") {
    if (s === "export") return !inv.hasFrom;
    if (s === "import") return !inv.hasTo;
    if (s === "") return !autoYes; // bare verb menu (under -y this is a usage error)
    return false;                  // unknown verb → dispatch reports the usage error
  }

  if (ns === "mcp") {
    // status enumerates every project under the root, so it always needs one —
    // unlike the mutating verbs, which an explicit --target short-circuits.
    if (s === "status") return true;
    if (s === "install" || s === "uninstall" || s === "update") return !inv.hasTarget;
    return false;                  // bare/unknown verb → dispatch prints the usage hint
  }
  // Top-level direct commands (namespace must be null). Trailing args are usage
  // errors, so only the exact single-token form needs the root.
  // `fork` no longer scans projects (Fork.app prefs only) → never needs the root.
  if (ns === null && SETUP_OPS[s] === true) return subs.length === 1 && !inv.hasTarget;
  // `scvn git` needs the root only for a REAL op run that would reach the picker:
  // an op flag is set, no explicit --target, single token. Bare `scvn git` (no
  // flag → prints the hint) and `--target` runs never open the picker.
  if (ns === null && s === "git") {
    return subs.length === 1 && !inv.hasTarget && Boolean(inv.hasGitOp);
  }

  return false; // doctor/config/help/version/unknown/bare
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

export interface GuardDeps {
  /** Resolve the configured/env root (home-expanded) or null. */
  resolveRoot: () => Promise<string | null>;
  /** True when `path` is an existing directory. */
  isDir: (path: string) => Promise<boolean>;
  /** Launch the `scvn config` editor flow (blocking). */
  runConfig: () => Promise<void>;
  /** Whether stdin is an interactive terminal. */
  isTTY: boolean;
  /** Abort the process — never returns. */
  fail: (message: string) => never;
  log: { step: (message: string) => void };
}

async function defaultIsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function defaultFail(message: string): never {
  throw new ConfigRequiredError(message);
}

function resolveGuardDeps(overrides: Partial<GuardDeps> = {}): GuardDeps {
  return {
    resolveRoot: overrides.resolveRoot ?? (async () => (await resolveProjectsRoot()).root),
    isDir:       overrides.isDir       ?? defaultIsDir,
    runConfig:   overrides.runConfig   ?? realRunConfig,
    isTTY:       overrides.isTTY       ?? Boolean(process.stdin.isTTY),
    fail:        overrides.fail        ?? defaultFail,
    log:         overrides.log         ?? realOutput.log,
  };
}

/**
 * Ensure a usable projects root is configured before a root-needing command runs.
 * No-op for invocations that don't need the root or already have a valid one.
 */
export async function ensureProjectsRootConfigured(
  inv: Invocation,
  depsOverride: Partial<GuardDeps> = {},
): Promise<void> {
  if (!needsProjectsRoot(inv)) return;
  const deps = resolveGuardDeps(depsOverride);

  const hasValidRoot = async (): Promise<boolean> => {
    const root = await deps.resolveRoot();
    return root !== null && (await deps.isDir(root));
  };

  if (await hasValidRoot()) return;

  // Cannot safely open an editor under -y or a non-interactive shell.
  if (inv.autoYes || !deps.isTTY) {
    deps.fail(MISSING_PROJECTS_ROOT_MESSAGE);
  }

  // Interactive: hand off to `scvn config`, then re-check ONCE (never loop).
  deps.log.step("No usable SCVN_PROJECTS_ROOT — opening `scvn config` first…");
  await deps.runConfig();

  if (!(await hasValidRoot())) {
    deps.fail(`${MISSING_PROJECTS_ROOT_MESSAGE} (still not usable after editing — set a valid path and re-run)`);
  }
}
