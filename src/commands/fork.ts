/**
 * commands/fork.ts — Linear clack flow for `scvn fork`.
 *
 * Configures Fork.app (the git GUI) for Unity smart-merge. It touches ONLY
 * Fork.app's own prefs via `defaults write` — it does NOT write git config or
 * any per-project `.gitattributes`. Project git artifacts are the job of
 * `scvn git`; fork is machine-level Fork.app setup only.
 *
 * Flow:
 *   1. macOS guard (non-darwin → log error + non-zero exit)
 *   2. precheck: detectForkRunning + detectBeyondCompare + detectUnityVersions → abort on blocker
 *   3. pick-unity: clack select from detectUnityVersions (source of yamlMergePath)
 *   4. confirm: render summary → clack confirm (decline → abort, writer NOT called)
 *   5. apply: spinner while writeForkPrefs
 *   6. summary: outro with result lines
 *
 * Flags:
 *   -y / autoYes  — skip confirmation prompt (confirm gate auto-approved)
 *   -n / dryRun   — no writes (writer skipped), dry-run label shown
 *   --no-beyond-compare — skip configuring Beyond Compare as Fork's diff tool
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { detectForkRunning } from "../detectors/detect-fork-running.js";
import { detectBeyondCompare } from "../detectors/detect-beyond-compare.js";
import { detectUnityVersions } from "../detectors/detect-unity-versions.js";
import type { UnityVersionInfo } from "../detectors/detect-unity-versions.js";
import { writeForkPrefs } from "../writers/write-fork-prefs.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ForkArgs {
  dryRun?:  boolean;
  autoYes?: boolean;
  /** Configure Beyond Compare as Fork's diff tool. Default true; `--no-beyond-compare` sets false. */
  beyondCompare?: boolean;
}

/** macOS-only message — Fork.app and `defaults write` are macOS-specific. */
export const FORK_MACOS_ONLY_MESSAGE =
  "scvn fork: macOS only (requires Fork.app and defaults command)";

/**
 * Result of the fork preflight: whether prerequisites are met, the first
 * blocker message when not, and the data the confirm/apply steps need. Pure —
 * no output, no prompts — so both the CLI flow and the GUI form can render it.
 */
export interface ForkPreflight {
  ok: boolean;
  /** First blocker message (for logs / GUI), or null when ok. */
  blocker: string | null;
  /** Short spinner label matching the original CLI precheck output, or null. */
  spinnerLabel: string | null;
  /** Beyond Compare path when found, else null. */
  beyondComparePath: string | null;
  /** Detected Unity editors (empty when none / non-darwin). */
  unityVersions: UnityVersionInfo[];
}

/** Outcome of applying the Fork prefs write. */
export interface ForkExecuteResult {
  ok: boolean;
  backupPath?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Preflight (pure) — macOS guard + blocker detection, shared by CLI and GUI
// ---------------------------------------------------------------------------

/**
 * Run the environment checks Fork setup requires. Detectors run in parallel.
 * Never prompts or logs; returns a structured result the caller renders.
 * May throw if a detector fails — callers wrap as they see fit.
 */
export async function forkPreflight(
  opts: { requireBeyondCompare?: boolean } = {},
): Promise<ForkPreflight> {
  const requireBeyondCompare = opts.requireBeyondCompare ?? true;
  if (process.platform !== "darwin") {
    return { ok: false, blocker: FORK_MACOS_ONLY_MESSAGE, spinnerLabel: FORK_MACOS_ONLY_MESSAGE, beyondComparePath: null, unityVersions: [] };
  }

  const [beyondCompare, unityVersions, forkRunning] = await Promise.all([
    detectBeyondCompare(),
    detectUnityVersions(),
    detectForkRunning(),
  ]);
  const beyondComparePath = beyondCompare.found ? beyondCompare.path : null;

  if (forkRunning) {
    return {
      ok: false,
      blocker: "Fork is running. Quit Fork and retry.",
      spinnerLabel: "Fork is running — quit it first",
      beyondComparePath,
      unityVersions,
    };
  }
  // Beyond Compare is a prerequisite only when the caller intends to configure
  // it as Fork's diff tool. When opted out, a missing BC is not a blocker — the
  // Unity merge-tool half is configured regardless.
  if (requireBeyondCompare && !beyondCompare.found) {
    return {
      ok: false,
      blocker: "Beyond Compare not found at /Applications/Beyond Compare.app. Install it first.",
      spinnerLabel: "Beyond Compare not found",
      beyondComparePath: null,
      unityVersions,
    };
  }
  if (unityVersions.length === 0) {
    return {
      ok: false,
      blocker: "No Unity editor found under /Applications/Unity/Hub/Editor. Install via Unity Hub.",
      spinnerLabel: "No Unity editor found",
      beyondComparePath,
      unityVersions: [],
    };
  }

  return { ok: true, blocker: null, spinnerLabel: null, beyondComparePath, unityVersions };
}

// ---------------------------------------------------------------------------
// Execute — apply the Fork prefs write + summary (the destructive half)
//
// The caller is the confirmation gate: this is only reached once the user has
// approved (CLI confirm prompt, or the GUI form's Apply button). Streams
// progress via the spinner and results via output.
// ---------------------------------------------------------------------------

export async function forkExecute(
  params: { yamlMergePath: string; dryRun: boolean; setupBeyondCompare: boolean },
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<ForkExecuteResult> {
  const { yamlMergePath, dryRun, setupBeyondCompare } = params;
  const applyLabel = dryRun ? "Apply  [dry-run]" : "Apply";
  const applySpinner = prompt.spinner();
  applySpinner.start(applyLabel);

  let result: ForkExecuteResult;

  if (dryRun) {
    // Dry-run: record what WOULD have been done without touching the plist
    result = { ok: true };
    applySpinner.stop(`${applyLabel}  (no writes — dry-run)`);
  } else {
    applySpinner.message(`${applyLabel}  writing Fork prefs…`);
    try {
      const written = await writeForkPrefs({ yamlMergePath, setupBeyondCompare });
      result = { ok: true, backupPath: written.backupPath };
    } catch (err: unknown) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    applySpinner.stop(
      result.ok ? `${applyLabel}  done` : `${applyLabel}  1 step(s) failed`,
      result.ok ? 0 : 1,
    );
  }

  // Summary — log results
  const label = setupBeyondCompare
    ? "Fork prefs (externalDiffTool/mergeTool)"
    : "Fork prefs (mergeTool)";
  if (result.ok) {
    output.log.success("Succeeded (1):");
    output.log.step(`  - ${label}${result.backupPath ? `  (backup: ${result.backupPath})` : ""}`);
  } else {
    output.log.error("Failed (1):");
    output.log.step(`  - ${label}${result.error ? `  — ${result.error}` : ""}`);
  }

  if (!dryRun) {
    output.log.info("Next steps:");
    output.log.step("  • Quit Fork and reopen — new settings take effect on restart.");
    output.log.step("  • Rollback plist: mv {bak} {original} then: killall cfprefsd");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entry point (CLI) — composes preflight + pick + confirm + execute
// ---------------------------------------------------------------------------

/**
 * Run the fork-setup flow as a linear clack sequence.
 * Accepts an optional prompt override for testing (fake adapter).
 *
 * macOS guard: non-darwin logs an error to stderr and sets exitCode 1 before
 * returning. Callers can rely on process.exitCode being set.
 */
export async function runFork(
  args: ForkArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  // macOS-only guard — surfaced before intro to keep CLI output identical.
  if (process.platform !== "darwin") {
    process.stderr.write(`${FORK_MACOS_ONLY_MESSAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;
  const beyondCompare = args.beyondCompare ?? true;

  output.intro("scvn fork");

  // Step 1: precheck — detect blockers in parallel
  const precheckSpinner = prompt.spinner();
  precheckSpinner.start("Checking prerequisites…");

  let pre: ForkPreflight;
  try {
    pre = await forkPreflight({ requireBeyondCompare: beyondCompare });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    precheckSpinner.stop(`precheck failed: ${message}`, 1);
    output.log.error(`Environment check error: ${message}`);
    process.exitCode = 1;
    return;
  }

  if (!pre.ok) {
    precheckSpinner.stop(pre.spinnerLabel ?? pre.blocker ?? "Prerequisites not met", 1);
    output.log.error(pre.blocker ?? "Prerequisites not met");
    process.exitCode = 1;
    return;
  }

  precheckSpinner.stop("Prerequisites OK");

  // Step 2: pick-unity — select which Unity editor supplies UnityYAMLMerge
  const unityOptions = pre.unityVersions.map((v) => ({
    value: v.editorPath,
    label: `${v.version}  (${v.editorPath})`,
  }));
  const initialUnity = pre.unityVersions[0]!.editorPath;

  let pickedEditorPath: string;
  if (autoYes) {
    pickedEditorPath = initialUnity;
    output.log.step(`Unity editor: auto-selected ${pickedEditorPath}`);
  } else {
    pickedEditorPath = await prompt.select({
      message: "Pick Unity editor",
      options:      unityOptions,
      initialValue: initialUnity,
    });
  }

  const pickedUnity = pre.unityVersions.find((v) => v.editorPath === pickedEditorPath)!;

  // Step 3: confirm — show summary, require explicit approval before writing.
  // THIS GATE IS THE DESTRUCTIVE-OP LOCK. The writer is NOT called if declined.
  const confirmLines = [
    "Pending writes:",
    "",
    "Fork prefs (defaults write com.DanPristupov.Fork):",
    ...(beyondCompare
      ? [`   externalDiffTool = 1  (Beyond Compare @ ${pre.beyondComparePath})`]
      : ["   externalDiffTool = (unchanged — Beyond Compare setup skipped)"]),
    "   mergeTool        = 8  (Custom)",
    `   externalMergeToolCustomPath = ${pickedUnity.yamlMergePath}`,
  ].join("\n");

  let approved: boolean;
  if (autoYes) {
    approved = true;
    output.log.step("confirm: auto-approved (-y)");
  } else {
    approved = await prompt.confirm({
      message:      confirmLines + "\n\nApply these changes?",
      initialValue: true,
    });
  }

  if (!approved) {
    output.log.warn("Aborted — no changes made.");
    output.outro("fork: cancelled");
    return;
  }

  // Step 4-5: apply + summary via the shared execute half.
  const result = await forkExecute({ yamlMergePath: pickedUnity.yamlMergePath, dryRun, setupBeyondCompare: beyondCompare }, prompt, output);

  if (!result.ok) {
    process.exitCode = 1;
    output.outro("fork: completed with errors");
  } else {
    output.outro(dryRun ? "fork: dry-run complete (no writes)" : "fork: done");
  }
}
