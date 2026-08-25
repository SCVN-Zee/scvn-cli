/**
 * desktop/host/ignore-dirty.ts — Host handlers for the Ignore-dirty page.
 *
 * Two plain request/response commands (no session prompts, no streaming):
 *   ignore-dirty:list → SubmoduleIgnoreList   (submodules + local/gitmodules state)
 *   ignore-dirty:set  → { localDirty }         (write one submodule's local override)
 *
 * Both delegate to the src feature module (readSubmoduleIgnoreState /
 * setSubmoduleIgnore) so the GUI reuses the exact git read/write path — the
 * toggle controls ONLY the local `.git/config` override, byte-identical to
 * `scvn ignore-dirty`, never the tracked `.gitmodules`.
 */

import {
  readSubmoduleIgnoreState,
  setSubmoduleIgnore,
} from "../../src/features/setup/submodule-ignore-state.js";
import type { SubmoduleIgnoreList } from "../shared/commands.js";

/** Read a required non-empty string arg, else throw. */
function requireStr(args: unknown, key: string): string {
  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ignore-dirty: missing "${key}" argument`);
  }
  return value;
}

export async function ignoreDirtyList(_session: unknown, args: unknown): Promise<SubmoduleIgnoreList> {
  const target = requireStr(args, "target");
  return (await readSubmoduleIgnoreState(target)) satisfies SubmoduleIgnoreList;
}

export async function ignoreDirtySet(_session: unknown, args: unknown): Promise<{ localDirty: boolean }> {
  const target = requireStr(args, "target");
  const name = requireStr(args, "name");
  const record = args as Record<string, unknown>;
  if (typeof record["ignored"] !== "boolean") {
    throw new Error('ignore-dirty: "ignored" argument must be a boolean');
  }
  const result = await setSubmoduleIgnore(target, name, record["ignored"]);
  if (result.status === "notRepo") {
    throw new Error(`ignore-dirty: not a git repo: ${target}`);
  }
  return { localDirty: result.localDirty };
}
