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
 *   2. precheck: detectForkRunning + detectUnityVersions
 *      → abort on blocker; a RUNNING FORK IS NOT A BLOCKER — warned here, then
 *      at apply: DEDICATED ASK → graceful quit-and-wait → write → reopen.
 *      (Fork flushes its prefs on quit and would clobber the write otherwise.)
 *   3. pick-unity: clack select from detectUnityVersions (source of yamlMergePath)
 *   4. confirm: render summary → clack confirm (decline → abort, writer NOT called)
 *   5. apply: [quit-ask →] quit-and-wait → writeForkPrefs → [reopen Fork]
 *   6. summary: outro with result lines
 *
 * Flags:
 *   -y / autoYes  — skip confirmation prompt (confirm gate auto-approved)
 *   -n / dryRun   — no writes (writer skipped), dry-run label shown
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { detectForkRunning } from "../detectors/detect-fork-running.js";
import { detectUnityVersions } from "../detectors/detect-unity-versions.js";
import type { UnityVersionInfo } from "../detectors/detect-unity-versions.js";
import { writeForkPrefs } from "../writers/write-fork-prefs.js";
import { quitForkApp, reopenForkApp, FORK_QUIT_TIMEOUT_MESSAGE } from "../lib/quit-fork.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ForkArgs {
  dryRun?:  boolean;
  autoYes?: boolean;
}

/** macOS-only message — Fork.app and `defaults write` are macOS-specific. */
export const FORK_MACOS_ONLY_MESSAGE =
  "scvn fork: macOS only (requires Fork.app and defaults command)";

/** Warned pre-apply when Fork.app is running; the quit ask happens at apply. */
export const FORK_RUNNING_WARNING =
  "Fork is running — scvn will ask to quit it, then reopen it after applying.";

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
  /** True when Fork.app is currently running — warn + auto-quit at apply, NOT a blocker. */
  forkRunning: boolean;
  /** Detected Unity editors (empty when none / non-darwin). */
  unityVersions: UnityVersionInfo[];
}

/** Outcome of applying the Fork prefs write. */
export interface ForkExecuteResult {
  ok: boolean;
  backupPath?: string;
  error?: string;
  /** True when the user declined the dedicated quit-Fork ask — nothing happened. */
  declined?: boolean;
  /** True when a quit we initiated was followed by a successful reopen. */
  reopened?: boolean;
}

// ---------------------------------------------------------------------------
// Preflight (pure) — macOS guard + blocker detection, shared by CLI and GUI
// ---------------------------------------------------------------------------

/**
 * Run the environment checks Fork setup requires. Detectors run in parallel.
 * Never prompts or logs; returns a structured result the caller renders.
 * May throw if a detector fails — callers wrap as they see fit.
 */
export async function forkPreflight(): Promise<ForkPreflight> {
  if (process.platform !== "darwin") {
    return { ok: false, blocker: FORK_MACOS_ONLY_MESSAGE, spinnerLabel: FORK_MACOS_ONLY_MESSAGE, forkRunning: false, unityVersions: [] };
  }

  const [unityVersions, forkRunning] = await Promise.all([
    detectUnityVersions(),
    detectForkRunning(),
  ]);

  // A running Fork is NOT a blocker: warn at this step, then quit-and-wait
  // at apply (see forkExecute). Fork must simply be gone before the write.
  if (unityVersions.length === 0) {
    return {
      ok: false,
      blocker: "No Unity editor found under /Applications/Unity/Hub/Editor. Install via Unity Hub.",
      spinnerLabel: "No Unity editor found",
      forkRunning,
      unityVersions: [],
    };
  }

  return { ok: true, blocker: null, spinnerLabel: null, forkRunning, unityVersions };
}

// ---------------------------------------------------------------------------
// Execute — apply the Fork prefs write + summary (the destructive half)
//
// The caller is the confirmation gate: this is only reached once the user has
// approved (CLI confirm prompt, or the GUI form's Apply button). Streams
// progress via the spinner and results via output.
// ---------------------------------------------------------------------------

export async function forkExecute(
  params: { yamlMergePath: string; dryRun: boolean; autoApproveQuit?: boolean },
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<ForkExecuteResult> {
  const { yamlMergePath, dryRun } = params;
  const autoApproveQuit = params.autoApproveQuit ?? false;
  const applyLabel = dryRun ? "Apply  [dry-run]" : "Apply";

  // Fresh state at apply time — the user may have quit or relaunched Fork
  // since preflight. Presence here drives ask → quit → reopen.
  const forkRunning = !dryRun && (await detectForkRunning());

  // THE QUIT GATE — a dedicated ask, never bundled into the apply confirm:
  // quitting the user's app needs its own explicit consent. Only -y (explicit
  // consent to run non-interactively) auto-approves it.
  let quitApproved = true;
  if (forkRunning && !autoApproveQuit) {
    quitApproved = await prompt.confirm({
      message: "Fork is running — quit it now to apply? Fork is reopened afterwards.",
      initialValue: true,
    });
  } else if (forkRunning && autoApproveQuit) {
    output.log.step("confirm: auto-approved (-y) — quit Fork");
  }

  let result: ForkExecuteResult;
  let forkWasQuit = false;
  let reopened = false;

  if (dryRun) {
    // Dry-run: record what WOULD have been done — no ask, no quit, no write,
    // no reopen. (The ask is skipped above because forkRunning is forced false.)
    result = { ok: true };
    const drySpinner = prompt.spinner();
    drySpinner.start(applyLabel);
    drySpinner.stop(`${applyLabel}  (no writes — dry-run)`);
  } else if (forkRunning && !quitApproved) {
    result = { ok: false, declined: true, error: "Fork quit declined — no changes made." };
    output.log.warn("Aborted — no changes made.");
  } else {
    const applySpinner = prompt.spinner();
    applySpinner.start(applyLabel);
    // Fork flushes its prefs (via cfprefsd) while quitting, so it must be
    // fully exited BEFORE `defaults write` or its flush can clobber ours.
    if (forkRunning) {
      applySpinner.message(`${applyLabel}  quitting Fork…`);
      const quit = await quitForkApp();
      if (quit === "timeout") {
        result = { ok: false, error: FORK_QUIT_TIMEOUT_MESSAGE };
      } else {
        forkWasQuit = true;
        result = { ok: true };
      }
    } else {
      result = { ok: true };
    }
    if (result.ok) {
      applySpinner.message(`${applyLabel}  writing Fork prefs…`);
      try {
        const written = await writeForkPrefs({ yamlMergePath });
        result = { ok: true, backupPath: written.backupPath };
      } catch (err: unknown) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    // Restore the state we changed — reopen only what we closed. Best-effort:
    // the write already succeeded, so a failed reopen downgrades to a hint.
    if (result.ok && forkWasQuit) {
      applySpinner.message(`${applyLabel}  reopening Fork…`);
      reopened = await reopenForkApp();
      result.reopened = reopened;
    }
    applySpinner.stop(
      result.ok ? `${applyLabel}  done` : `${applyLabel}  1 step(s) failed`,
      result.ok ? 0 : 1,
    );
  }

  // Summary — log results
  const label = "Fork prefs (mergeTool)";
  if (result.ok) {
    output.log.success("Succeeded (1):");
    output.log.step(`  - ${label}${result.backupPath ? `  (backup: ${result.backupPath})` : ""}`);
    if (forkWasQuit) {
      output.log.info(
        reopened
          ? "Fork was quit and reopened — new settings are live."
          : "Fork was quit; it could not be reopened — open Fork manually for the new settings.",
      );
    }
  } else if (!result.declined) {
    output.log.error("Failed (1):");
    output.log.step(`  - ${label}${result.error ? `  — ${result.error}` : ""}`);
  }

  if (!dryRun && !result.declined) {
    output.log.info("Next steps:");
    if (!forkWasQuit) {
      output.log.step("  • Quit Fork and reopen — new settings take effect on restart.");
    }
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

  output.intro("scvn fork");

  // Step 1: precheck — detect blockers in parallel
  const precheckSpinner = prompt.spinner();
  precheckSpinner.start("Checking prerequisites…");

  let pre: ForkPreflight;
  try {
    pre = await forkPreflight();
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

  // A running Fork is never handled silently — the user learns now that apply
  // will ASK before quitting their app (dry-run warns but never asks/quits).
  if (pre.forkRunning) {
    output.log.warn(FORK_RUNNING_WARNING);
  }

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
    ...(pre.forkRunning ? ["Fork is running — you will be asked to quit it (it reopens afterwards).", ""] : []),
    "Fork prefs (defaults write com.DanPristupov.Fork):",
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

  // Step 4-5: apply + summary via the shared execute half. The quit-ask (and
  // reopen, when approved) lives inside forkExecute so the GUI gets it too.
  const result = await forkExecute(
    { yamlMergePath: pickedUnity.yamlMergePath, dryRun, autoApproveQuit: autoYes },
    prompt,
    output,
  );

  if (result.declined) {
    // The user said no at the quit-Fork ask — a cancel, not a failure.
    output.outro("fork: cancelled");
    return;
  }
  if (!result.ok) {
    process.exitCode = 1;
    output.outro("fork: completed with errors");
  } else {
    output.outro(dryRun ? "fork: dry-run complete (no writes)" : "fork: done");
  }
}
