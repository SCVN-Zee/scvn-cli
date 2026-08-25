/**
 * lib/backup.ts — Create timestamped backup copies of files before mutation.
 *
 * Returns empty string if the source does not exist (no backup needed).
 * Ported from fork-unity-setup/src/lib/backup.ts — import path adjusted only.
 */

import fs from "fs/promises";
import { BACKUP_SUFFIX } from "./fork-paths.js";

function timestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export async function backupFile(filePath: string): Promise<string> {
  try {
    await fs.access(filePath);
  } catch {
    return "";
  }
  const backupPath = `${filePath}.${BACKUP_SUFFIX}-${timestamp()}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}
