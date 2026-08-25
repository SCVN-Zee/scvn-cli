/**
 * commands/git-migration-hint.ts — v0.4 → v0.5 grammar break message.
 *
 * `scvn gitignore` and `scvn gitexclude` were grouped into the flag-driven
 * `scvn git` command. The old top-level tokens print this table and the caller
 * exits 1 — scripts fail loudly with the fix in hand.
 */

export const GIT_GROUPING_HINT = `scvn gitignore / scvn gitexclude were grouped into scvn git in v0.5:
  scvn gitignore   → scvn git --ignore
  scvn gitexclude  → scvn git --exclude
New: scvn git --lfs sets up Git LFS (install + .gitattributes).
  Combine them:    scvn git --ignore --exclude --lfs`;

/** Print the grouping hint to stderr. Caller is responsible for exit code. */
export function printGitGroupingHint(): void {
  console.error(GIT_GROUPING_HINT);
}
