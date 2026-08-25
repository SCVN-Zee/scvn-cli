/**
 * commands/shared/clack-confirm.ts — SyncConfirm backed by a clack prompt.
 *
 * autoYes → autoConfirm (no TTY); otherwise title+body render as one
 * confirm message. Shared by every command flow that gates feature writes.
 */

import type { PromptAdapter } from "../../ui/prompt.js";
import { autoConfirm } from "../../features/transfer/reporter.js";
import type { SyncConfirm } from "../../features/transfer/reporter.js";

export function clackConfirm(prompt: PromptAdapter, autoYes: boolean): SyncConfirm {
  return autoYes
    ? autoConfirm
    : async ({ title, body }) =>
        prompt.confirm({ message: body ? `${title}\n${body}` : title });
}
