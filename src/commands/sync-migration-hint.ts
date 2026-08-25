/**
 * commands/sync-migration-hint.ts — v0.1 → v0.2 grammar break message.
 *
 * `scvn sync …` and bare `scvn all` were replaced by the noun-first
 * export/import grammar. The stub prints the exact replacement for every old
 * command and the caller exits 1 — scripts fail loudly with the fix in hand.
 */

export const SYNC_MIGRATION_HINT = `scvn sync was replaced in v0.2:
  scvn sync toolkit   → removed
  scvn sync packages  → scvn packages export +  scvn packages import
  scvn sync mcp       → removed
  scvn sync all       → scvn packages import`;

/** Print the migration table to stderr. Caller is responsible for exit code. */
export function printSyncMigrationHint(): void {
  console.error(SYNC_MIGRATION_HINT);
}
