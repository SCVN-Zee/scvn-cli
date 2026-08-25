/**
 * services/rsync.ts — rsync CLI wrappers with flag parity to bash common.sh rsync_copy.
 *
 * Ported from sync-unity/src/services/rsync.ts with import paths adjusted for scvn.
 *
 * Flag parity (CRITICAL — Unity .meta GUID integrity depends on this):
 *   -a              always (archive: preserves perms, times, symlinks, etc.)
 *   --delete-after  when src ends with "/" (mirror directory contents)
 *   --dry-run       when opts.dryRun is true
 *   --info=progress2 --stats  when opts.progress is true + rsync >=3.1
 *   --itemize-changes         fallback for rsync <3.1 (macOS system rsync 2.6.9)
 */

import { execa } from "execa";

// ---------------------------------------------------------------------------
// Version detection — cached at module level (one shell-out per process)
// ---------------------------------------------------------------------------

let _rsyncVersion: { major: number; minor: number } | null = null;

/**
 * Returns true if the rsync binary in PATH supports --info=progress2
 * (requires rsync >= 3.1.0). Result is cached after first call.
 */
export async function rsyncSupportsProgress2(): Promise<boolean> {
  if (_rsyncVersion === null) {
    try {
      const { stdout } = await execa("rsync", ["--version"]);
      const versionMatch = stdout.match(/version\s+(\d+)\.(\d+)/);
      _rsyncVersion = versionMatch
        ? { major: Number(versionMatch[1]), minor: Number(versionMatch[2]) }
        : { major: 0, minor: 0 };
    } catch {
      _rsyncVersion = { major: 0, minor: 0 };
    }
  }
  return (
    _rsyncVersion.major > 3 ||
    (_rsyncVersion.major === 3 && _rsyncVersion.minor >= 1)
  );
}

/** @internal Exposed for testing only — resets the cached version. */
export function _resetRsyncVersionCache(): void {
  _rsyncVersion = null;
}

// ---------------------------------------------------------------------------
// CurrentFile — emitted by itemize-changes fallback path
// ---------------------------------------------------------------------------

export interface CurrentFile {
  kind: "file";
  path: string;
}

/**
 * Parse a single rsync --itemize-changes output line.
 * Returns null for non-transfer lines (deletions *deleting, stats, progress, blank lines).
 */
export function parseItemizeLine(line: string): CurrentFile | null {
  const match = line.match(
    /^[<>ch.*][fdLDS]\S{9}\s+(.+)$/
  );
  return match && match[1] ? { kind: "file", path: match[1] } : null;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RsyncOpts {
  /** Pass --dry-run to rsync (no files written) */
  dryRun?: boolean;
  /**
   * Override --delete-after logic. When undefined, --delete-after is added
   * automatically if src ends with "/". Set to false to suppress it explicitly.
   */
  deleteAfter?: boolean;
  /** When true, adds --info=progress2 --stats for streaming progress */
  progress?: boolean;
}

export interface RsyncProgress {
  /** Bytes transferred so far */
  bytes: number;
  /** Completion percentage (0–100) */
  percentage: number;
  /** Transfer rate string as reported by rsync (e.g. "12.34MB/s") */
  rate: string;
  /** Files still to transfer */
  filesRemaining: number;
  /** Total files in the transfer */
  filesTotal: number;
}

export interface RsyncResult {
  exitCode: number;
  /** Number of files transferred (from --stats output) */
  filesTransferred: number;
  /** Total bytes transferred (from --stats output) */
  totalBytes: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildFlags(src: string, opts: RsyncOpts, hasProgress2 = false): string[] {
  const flags: string[] = ["-a"];

  if (opts.deleteAfter !== false && src.endsWith("/")) {
    flags.push("--delete-after");
  }
  if (opts.deleteAfter === true && !src.endsWith("/")) {
    flags.push("--delete-after");
  }

  if (opts.dryRun) flags.push("--dry-run");

  if (opts.progress) {
    if (hasProgress2) {
      flags.push("--info=progress2", "--stats");
    } else {
      flags.push("--itemize-changes");
    }
  }

  return flags;
}

/**
 * Parse a single rsync --info=progress2 progress line.
 * Returns null for lines that don't match.
 */
export function parseProgressLine(line: string): RsyncProgress | null {
  const match = line.match(
    /\s*([\d,]+)\s+(\d+)%\s+([\d.]+[kKmMgGtT]?B\/s)\s.*?to-chk=(\d+)\/(\d+)/
  );
  if (!match) return null;

  return {
    bytes: Number((match[1] ?? "0").replace(/,/g, "")),
    percentage: Number(match[2] ?? "0"),
    rate: match[3] ?? "",
    filesRemaining: Number(match[4] ?? "0"),
    filesTotal: Number(match[5] ?? "0"),
  };
}

function parseStats(output: string): RsyncResult {
  const filesMatch = output.match(/Number of (?:regular )?files transferred:\s*([\d,]+)/);
  const bytesMatch = output.match(/Total transferred file size:\s*([\d,]+)/);

  return {
    exitCode: 0,
    filesTransferred: filesMatch
      ? Number((filesMatch[1] ?? "0").replace(/,/g, ""))
      : 0,
    totalBytes: bytesMatch
      ? Number((bytesMatch[1] ?? "0").replace(/,/g, ""))
      : 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Streaming rsync: yields progress events then a final RsyncResult.
 */
export async function* rsyncCopyStream(
  src: string,
  dst: string,
  opts: RsyncOpts = {}
): AsyncGenerator<RsyncProgress | CurrentFile | RsyncResult> {
  const hasProgress2 = opts.progress ? await rsyncSupportsProgress2() : false;
  const flags = buildFlags(src, opts, hasProgress2);

  const subprocess = execa("rsync", [...flags, "--", src, dst], {
    all: false,
    stdout: "pipe",
    stderr: "pipe",
  });

  let bufferedLine = "";

  if (subprocess.stdout) {
    for await (const chunk of subprocess.stdout) {
      bufferedLine += (chunk as Buffer).toString();
      const lines = bufferedLine.split(/[\r\n]+/);
      bufferedLine = lines.pop() ?? "";
      for (const line of lines) {
        if (hasProgress2) {
          const progress = parseProgressLine(line);
          if (progress) yield progress;
        } else if (opts.progress) {
          const currentFile = parseItemizeLine(line);
          if (currentFile) yield currentFile;
        }
      }
    }
  }

  try {
    const result = await subprocess;
    const stats = parseStats(result.stdout ?? "");
    yield stats;
  } catch (error: unknown) {
    throw error;
  }
}

/**
 * Simple (non-streaming) rsync copy.
 * Inherits stdio so rsync output goes directly to the terminal.
 * Throws on non-zero exit.
 */
export async function rsyncCopy(
  src: string,
  dst: string,
  opts: Omit<RsyncOpts, "progress"> = {}
): Promise<void> {
  const flags = buildFlags(src, { ...opts, progress: false }, false);
  await execa("rsync", [...flags, "--", src, dst], { stdio: "inherit" });
}
