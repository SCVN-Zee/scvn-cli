/**
 * util/fatal-error.ts — Turn an escaped throw into a CLI error line.
 *
 * cli.tsx is a top-level-await script: a rejected `await runPackages(...)` in an
 * ESM entry module is NOT delivered to an `unhandledRejection` listener (verified
 * against Node 24) — Node prints the stack and exits 1. So the net has to be
 * `uncaughtException`, with `unhandledRejection` added for stray floating promises.
 *
 * Expected, user-facing failures are prefixed `scvn:` by whoever threw them
 * ("scvn: package catalog not found at …"). Those print as a single line. Anything
 * else is a programming error and keeps its full stack — prettifying a TypeError
 * would just hide the bug.
 */

const EXPECTED = /^scvn:/;

/** Render an escaped throw for stderr. Pure — the handlers do the I/O. */
export function formatFatal(error: unknown): string {
  if (error instanceof Error) {
    if (EXPECTED.test(error.message)) return error.message;
    return error.stack ?? error.message;
  }
  return `scvn: ${String(error)}`;
}

/** Install process-level nets. Call once, before any await in the entry module. */
export function installFatalHandlers(): void {
  const fail = (error: unknown): void => {
    process.stderr.write(`${formatFatal(error)}\n`);
    process.exit(1);
  };

  process.on("uncaughtException", fail);
  process.on("unhandledRejection", fail);
}
