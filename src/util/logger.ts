/**
 * util/logger.ts — Colored terminal loggers (no Ink dependency).
 *
 * Ported from sync-unity wholesale. Matches bash common.sh log format:
 *   info  → "==> bold text"  (cyan arrow)
 *   ok    → " ✓ text"        (green)
 *   warn  → " ! text"        (yellow)
 *   err   → " ✗ text"        (red, to stderr)
 *   dim   → "    text"       (dim)
 */

const isTTY = process.stdout.isTTY && !process.env["NO_COLOR"];

const RESET  = isTTY ? "\x1b[0m"  : "";
const DIM    = isTTY ? "\x1b[2m"  : "";
const BOLD   = isTTY ? "\x1b[1m"  : "";
const CYAN   = isTTY ? "\x1b[36m" : "";
const GREEN  = isTTY ? "\x1b[32m" : "";
const YELLOW = isTTY ? "\x1b[33m" : "";
const RED    = isTTY ? "\x1b[31m" : "";

export function info(message: string): void {
  process.stdout.write(`${CYAN}==>${RESET} ${BOLD}${message}${RESET}\n`);
}

export function ok(message: string): void {
  process.stdout.write(` ${GREEN}✓${RESET} ${message}\n`);
}

export function warn(message: string): void {
  process.stdout.write(` ${YELLOW}!${RESET} ${message}\n`);
}

export function err(message: string): void {
  process.stderr.write(` ${RED}✗${RESET} ${message}\n`);
}

export function dim(message: string): void {
  process.stdout.write(`    ${DIM}${message}${RESET}\n`);
}
