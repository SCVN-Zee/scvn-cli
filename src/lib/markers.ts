/**
 * lib/markers.ts — Replace or insert a marker-delimited block in a text file.
 *
 * Handles balanced / unbalanced marker detection and refuses ambiguous files.
 * The marker pair is parameterized: callers that pass no pair get the default
 * fork-unity-setup markers (unchanged behavior). A distinct pair (e.g. the LFS
 * `# BEGIN/END scvn-lfs` markers) lets an independent block coexist in the same
 * file — replacing one block never touches another with a different pair.
 *
 * Ported from fork-unity-setup/src/lib/markers.ts — generalized to a marker pair.
 */

import { MARKER_BEGIN, MARKER_END } from "./fork-paths.js";

export interface MarkerPair {
  begin: string;
  end: string;
}

/** Default marker pair — the fork-unity-setup smart-merge block. */
const FORK_MARKERS: MarkerPair = { begin: MARKER_BEGIN, end: MARKER_END };

export function replaceMarkerBlock(
  text: string,
  inner: string,
  markers: MarkerPair = FORK_MARKERS,
): string {
  const { begin, end } = markers;
  const block = `${begin}\n${inner}\n${end}`;
  const beginCount = countOccurrences(text, begin);
  const endCount = countOccurrences(text, end);

  // Unbalanced or duplicated markers mean a prior crash / hand-edit left the
  // file in an ambiguous state. Refusing to touch avoids silently deleting
  // content between an orphan BEGIN and the next paired END.
  if (beginCount !== endCount) {
    throw new Error(
      `Unbalanced ${begin} / ${end} markers (${beginCount} BEGIN, ${endCount} END). ` +
        `Resolve manually before re-running.`,
    );
  }
  if (beginCount > 1) {
    throw new Error(
      `Multiple ${begin} marker blocks found (${beginCount}). ` +
        `Expected 0 or 1. Resolve manually before re-running.`,
    );
  }

  const blockRegex = new RegExp(
    `${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}`,
  );
  if (blockRegex.test(text)) {
    return text.replace(blockRegex, block);
  }
  const prefix = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  const separator = text.length === 0 ? "" : "\n";
  return `${text}${prefix}${separator}${block}\n`;
}

/**
 * Remove every balanced marker block of `markers` from `text`.
 *
 * Deliberately forgiving where replaceMarkerBlock throws: a removal has no
 * content to lose, so an absent pair is a no-op and duplicated blocks are all
 * dropped. An orphan marker (no partner) delimits nothing and is left in place
 * for the user to resolve. Blank lines left behind are preserved — collapsing
 * them would rewrite bytes the caller never asked us to touch.
 */
export function stripMarkerBlock(
  text: string,
  markers: MarkerPair = FORK_MARKERS,
): string {
  const { begin, end } = markers;
  const blockRegex = new RegExp(
    `${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}\\n?`,
    "g",
  );
  return text.replace(blockRegex, "");
}

function countOccurrences(text: string, marker: string): number {
  const markerRegex = new RegExp(escapeRegex(marker), "g");
  return (text.match(markerRegex) ?? []).length;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
