/**
 * ui/clack.ts — Thin wrappers over @clack/prompts for consistent chrome across
 * all linear command flows.
 *
 * Consumers import from here (not directly from @clack/prompts) so the styling
 * layer — picocolors theme, title formatting — stays in one place.
 *
 * Re-exports: intro, outro, log (info/success/warn/error/step), spinner.
 */

import {
  intro as clackIntro,
  outro as clackOutro,
  log as clackLog,
  spinner as clackSpinner,
} from "@clack/prompts";
import pc from "picocolors";

// ---------------------------------------------------------------------------
// Themed intro / outro
// ---------------------------------------------------------------------------

/**
 * Print the connector-bar intro header.
 * Title is bold + cyan to match the screenshot chrome.
 */
export function intro(title: string): void {
  clackIntro(pc.bold(pc.cyan(title)));
}

/**
 * Print the connector-bar outro footer.
 * Message is dimmed by convention (muted closing line).
 */
export function outro(message: string): void {
  clackOutro(pc.dim(message));
}

// ---------------------------------------------------------------------------
// Log shortcuts (structured step output lines)
// ---------------------------------------------------------------------------

export const log = {
  /** Neutral informational line. */
  info(message: string): void {
    clackLog.info(message);
  },

  /** Green success line — check passed. */
  success(message: string): void {
    clackLog.success(message);
  },

  /** Yellow warning line — check passed with caveats. */
  warn(message: string): void {
    clackLog.warn(message);
  },

  /** Red error line — check failed. */
  error(message: string): void {
    clackLog.error(message);
  },

  /** Dimmed step annotation (used for subordinate detail lines). */
  step(message: string): void {
    clackLog.step(message);
  },
} as const;

// ---------------------------------------------------------------------------
// Spinner re-export (typed for convenience)
// ---------------------------------------------------------------------------

export { clackSpinner as spinner };
