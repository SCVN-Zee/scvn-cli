/**
 * commands/setup-migration-hint.ts — v0.2 → v0.3 grammar break message.
 *
 * The setup namespace was replaced by direct top-level commands; the run-all
 * op and the operation menu were removed. The stub prints the exact
 * replacement for every old command and the caller exits 1 — scripts fail
 * loudly with the fix in hand.
 */

export const SETUP_MIGRATION_HINT = `scvn setup was replaced in v0.3 — ops are top-level commands:
  scvn setup luna-submodule  → scvn ignore-dirty
  scvn setup gitignore       → scvn git --ignore
  scvn setup gitexclude      → scvn git --exclude
  scvn setup fork            → scvn fork
  scvn setup all / (menu)    → removed — run ops individually`;

/** Print the migration table to stderr. Caller is responsible for exit code. */
export function printSetupMigrationHint(): void {
  console.error(SETUP_MIGRATION_HINT);
}
