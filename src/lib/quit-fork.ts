/**
 * lib/quit-fork.ts — Gracefully quit Fork.app and wait for it to exit.
 *
 * Fork keeps its preferences in memory and flushes them to
 * com.DanPristupov.Fork.plist (via cfprefsd) while quitting. Writing that
 * plist while Fork is alive means Fork's own on-quit flush can clobber the
 * write. So before any `defaults write`: send a graceful Apple-Event quit,
 * poll until the process is gone, then let cfprefsd settle.
 *
 * Escalation policy: graceful quit ONLY. We never SIGKILL the user's git
 * client — if Fork refuses to quit (modal up), we time out and the caller
 * surfaces an honest "quit it manually" failure with nothing written.
 */

import { execa } from "execa";
import { detectForkRunning } from "../detectors/detect-fork-running.js";
import { FORK_BUNDLE_ID } from "./fork-paths.js";

export type QuitForkStatus = "quit" | "not-running" | "timeout";

export const FORK_QUIT_TIMEOUT_MESSAGE =
  "Fork did not quit in time — quit Fork manually and re-run.";

export interface QuitForkOptions {
  /** How long to wait for Fork to exit after the quit event (default 8s). */
  timeoutMs?: number;
  /** Poll interval while waiting (default 250ms; tests pass small values). */
  pollMs?: number;
  /** Settle delay after exit for cfprefsd's flush (default 500ms). */
  settleMs?: number;
}


/**
 * Quit Fork.app gracefully and wait until it is gone.
 * - "not-running": Fork wasn't running — no Apple Event sent, no waiting.
 * - "quit": quit event sent, process exited, cfprefsd settle elapsed.
 * - "timeout": Fork still alive after timeoutMs — caller must NOT write.
 */
export async function quitForkApp(opts: QuitForkOptions = {}): Promise<QuitForkStatus> {
  const { timeoutMs = 8_000, pollMs = 250, settleMs = 500 } = opts;
  if (!(await detectForkRunning())) return "not-running";

  // Graceful quit — same as Cmd+Q. reject:false: a scripting error just
  // means we fall through to polling; the timeout catches a stubborn Fork.
  await execa("osascript", ["-e", `quit app id "${FORK_BUNDLE_ID}"`], { reject: false });

  const deadline = Date.now() + timeoutMs;
  while (await detectForkRunning()) {
    if (Date.now() >= deadline) return "timeout";
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
  // Fork exited — give its on-quit cfprefsd flush time to land before writes.
  if (settleMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
  }
  return "quit";
}

/**
 * Reopen Fork.app after a quit we initiated — restore the state we changed.
 * Best-effort: the prefs write has already succeeded by the time this runs,
 * so failure is surfaced by the caller, never fatal here.
 */
export async function reopenForkApp(): Promise<boolean> {
  const result = await execa("open", ["-b", FORK_BUNDLE_ID], { reject: false });
  return result.exitCode === 0;
}
