/**
 * commands/shared/confirm-import-summary.ts — One confirm for all targets.
 *
 * Import flows confirm ONCE with the full picture instead of per target:
 *   staged: Hub @ main, 2d ago, 142.0 MB
 *   → ~/projects/GameA/Assets/Plugins/Sirenix  (will OVERWRITE)
 *   → ~/projects/GameB/Assets/Plugins/Sirenix  (new)
 *
 * autoYes skips the prompt (returns true) — target selection already
 * required explicit --to under -y, so consent is established.
 */

import path from "node:path";
import type { PromptAdapter } from "../../ui/prompt.js";
import { exists } from "../../util/fs-predicates.js";
import { shortenPath } from "../../util/paths.js";

export interface ImportSummaryOpts {
  /** Confirm title, e.g. "Import 3 package(s) into GameA?" */
  title: string;
  /** Provenance line from formatProvenance() */
  provenance: string;
  /** Target project paths (Assets dirs) */
  targets: string[];
  /** Path(s) checked under each target to label new vs OVERWRITE */
  rels: string[];
  autoYes?: boolean;
}

export async function confirmImportSummary(
  prompt: PromptAdapter,
  opts: ImportSummaryOpts,
): Promise<boolean> {
  if (opts.autoYes) return true;

  const rows = await Promise.all(
    opts.targets.map(async (target) => {
      const anyExisting = (
        await Promise.all(opts.rels.map((rel) => exists(path.join(target, rel))))
      ).some(Boolean);
      const state = anyExisting ? "will OVERWRITE" : "new";
      return `→ ${shortenPath(target)}  (${state})`;
    })
  );

  const body = [`staged: ${opts.provenance}`, ...rows].join("\n");
  return prompt.confirm({ message: `${opts.title}\n${body}` });
}
