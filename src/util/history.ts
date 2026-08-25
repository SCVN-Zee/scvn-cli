/**
 * util/history.ts — JSONL append-only history at ~/.scvn/history.jsonl
 *
 * Each line is a self-contained JSON object (HistoryEntry).
 * getRecentProjects reads the tail of the file and returns the N most
 * recently seen unique project src/target paths.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { getHistoryPath } from "../config/paths.js";


export interface HistoryEntry {
  /** ISO 8601 timestamp */
  ts: string;
  /** "sync" is the pre-v0.2 kind — kept so old JSONL files still parse */
  kind: "sync" | "config" | "export" | "import" | "add" | "remove";
  /** source project path (Assets dir), if applicable */
  src?: string;
  /** target project path (Assets dir), if applicable */
  target?: string;
  /** step name, e.g. 'packages' */
  step?: string;
  status: "ok" | "fail";
}

/** Append one entry to the JSONL history file. Creates dirs if absent. */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await mkdir(dirname(getHistoryPath()), { recursive: true });
  await appendFile(getHistoryPath(), JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Return the N most recently used unique project paths (src or target).
 * Reads the entire file — suitable for a config file that grows slowly.
 * Returns paths in most-recently-used order.
 */
export async function getRecentProjects(limit = 5): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(getHistoryPath(), "utf8");
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: HistoryEntry;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      entry = JSON.parse(lines[i] as string);
    } catch {
      continue;
    }
    for (const path of [entry.src, entry.target]) {
      if (path && !seen.has(path)) {
        seen.add(path);
        result.push(path);
        if (result.length >= limit) return result;
      }
    }
  }

  return result;
}

/**
 * Return the most recently selected src and target project paths, scoped by role.
 * Walks the JSONL history newest-first and picks the first entry that wrote
 * each role. Either side may be null if never recorded.
 */
export async function getLastProjectsByRole(): Promise<{ src: string | null; target: string | null }> {
  let raw: string;
  try {
    raw = await readFile(getHistoryPath(), "utf8");
  } catch {
    return { src: null, target: null };
  }

  let lastSrc: string | null = null;
  let lastTarget: string | null = null;

  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: HistoryEntry;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      entry = JSON.parse(lines[i] as string);
    } catch {
      continue;
    }
    if (lastSrc === null && entry.src) lastSrc = entry.src;
    if (lastTarget === null && entry.target) lastTarget = entry.target;
    if (lastSrc !== null && lastTarget !== null) break;
  }

  return { src: lastSrc, target: lastTarget };
}
