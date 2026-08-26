/**
 * desktop/host/capabilities.ts — Registry entries for the seven scvn commands.
 *
 * Each entry builds a GUI PromptAdapter + OutputAdapter from the invocation's
 * session, parses the renderer's launch values into the handler's arg shape, and
 * calls the EXISTING handler verbatim (Approach A — no logic duplication). The
 * handlers drive any further prompts (project pickers, confirmations) through
 * the injected GUI adapter, so the GUI reuses the CLI flows exactly.
 *
 * GUI invocations never set `autoYes` — they always take the interactive branch
 * and supply explicit values, so the `--yes requires a target` guards never fire.
 */

import { runConfigExecute } from "../../src/commands/config.js";
import { runDoctor } from "../../src/commands/doctor.js";
import { forkPreflight, forkExecute, type ForkPreflight } from "../../src/commands/fork.js";
import { runGitCommand } from "../../src/commands/git.js";
import { runMcp } from "../../src/commands/mcp.js";
import { runPackages } from "../../src/commands/packages.js";
import { ignoreDirtyList, ignoreDirtySet } from "./ignore-dirty.js";
import { discoverSetupTargetsRich } from "../../src/commands/shared/select-setup-target.js";
import { MCP_ADDON_OPTIONS } from "../../src/commands/shared/select-mcp-addons.js";
import { DEFAULT_ADDONS } from "../../src/features/mcp/mcp-constants.js";
import { isInstalled, markerVersion } from "../../src/features/mcp/marker.js";
import { listStagedVersions, writeCacheDir } from "../../src/features/mcp/resolve-mcp-cache.js";
import { templatesRead, templatesWrite, templatesReset } from "./templates.js";
import { setupMergeAttributes } from "../../src/features/setup/setup-merge-attributes.js";
import { loadConfig } from "../../src/config/load.js";
import type { CommandRegistry } from "./dispatcher.js";
import type { HostSession } from "./session.js";
import { createGuiPrompt } from "./gui-prompt.js";
import { createGuiOutput } from "./gui-output.js";
import type {
  FormModel,
  LaunchField,
  PackagesSourceResult,
  PackagesLibraryModel,
  McpProjectStatus,
} from "../shared/commands.js";
import path from "node:path";
import { readPackagesStoreMeta, formatPackageProvenance, resolveEffectiveStoreDir } from "../../src/features/store/index.js";
import { removePackages, resolveAddFolder } from "../../src/features/packages/index.js";

// ---------------------------------------------------------------------------
// Launch-arg parsing (renderer sends a Record over IPC, typed `unknown` here)
// ---------------------------------------------------------------------------

function asRecord(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

/** Read a non-empty string field, else undefined. */
function str(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Read a boolean field, defaulting to false. */
function bool(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

/** Read a string[] field, keeping only string members; [] when absent. */
function strArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Read the staged package library (per-package provenance) for the list UI. */
async function readLibraryModel(): Promise<PackagesLibraryModel> {
  const effective = await resolveEffectiveStoreDir("packages");
  const meta = await readPackagesStoreMeta(effective?.storeDir);
  return {
    packages: (meta?.packages ?? []).map((p) => ({
      label:      p.label,
      relPath:    p.relPath,
      provenance: formatPackageProvenance(p),
      sourcePath: p.sourcePath,
      bytes:      p.bytes,
    })),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Command handlers for the capabilities, with GUI adapters injected. */
export const capabilities: CommandRegistry = {
  // --- fork: native form (Phase 4) ---------------------------------------
  // prepare: run the environment preflight and return the Unity picker + a
  // blocker when a prerequisite is unmet; execute: apply the chosen editor.
  async "fork:prepare"(): Promise<unknown> {
    let pre: ForkPreflight;
    try {
      pre = await forkPreflight({ requireBeyondCompare: false });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        fields: [],
        blocker: `Environment check error: ${message}`,
      } satisfies FormModel;
    }

    if (!pre.ok) {
      return {
        fields: [],
        blocker: pre.blocker ?? "Prerequisites not met",
      } satisfies FormModel;
    }

    const editorField: LaunchField = {
      name: "editorPath",
      label: "Unity editor",
      type: "select",
      default: pre.unityVersions[0]!.editorPath,
      options: pre.unityVersions.map((v) => ({ value: v.editorPath, label: `${v.version}  (${v.editorPath})` })),
    };
    // Beyond Compare diff-tool setup is optional. Default on when BC is present,
    // off when absent — turning it on without BC installed surfaces the honest
    // "Beyond Compare not found" block at Apply.
    const setupBcField: LaunchField = {
      name: "setupBeyondCompare",
      label: "Configure Beyond Compare (diff tool)",
      type: "boolean",
      default: pre.beyondComparePath !== null,
    };
    // Optional git-side half: write the Unity smart-merge `.gitattributes`
    // block to a chosen project. Off by default (Fork prefs are machine-level;
    // this one touches a repo). The pen edits the `gitattributes-merge`
    // template inline, same as the Git-setup ops.
    const applyMergeField: LaunchField = {
      name: "applyMergeAttributes",
      label: "Also write Unity merge .gitattributes to a project",
      type: "boolean",
      default: false,
      templateKey: "gitattributesMerge",
    };
    const mergeTargetField: LaunchField = {
      name: "mergeTarget",
      label: "Merge-attributes target project",
      type: "project",
      visibleWhen: { field: "applyMergeAttributes", equals: "true" },
    };
    return {
      note: pre.beyondComparePath !== null
        ? `Beyond Compare @ ${pre.beyondComparePath} · writes Fork.app prefs`
        : "Beyond Compare not found · the Unity merge tool is still configured",
      fields: [editorField, setupBcField, applyMergeField, mergeTargetField],
    } satisfies FormModel;
  },

  async fork(session: HostSession, args: unknown): Promise<unknown> {
    const record = asRecord(args);
    const output = createGuiOutput(session);
    const prompt = createGuiPrompt(session);

    const setupBeyondCompare = bool(record, "setupBeyondCompare");
    const pre = await forkPreflight({ requireBeyondCompare: setupBeyondCompare });
    if (!pre.ok) {
      output.log.error(pre.blocker ?? "Prerequisites not met");
      return { ok: false };
    }
    const editorPath = str(record, "editorPath") ?? pre.unityVersions[0]!.editorPath;
    const picked = pre.unityVersions.find((v) => v.editorPath === editorPath) ?? pre.unityVersions[0]!;
    const result = await forkExecute({ yamlMergePath: picked.yamlMergePath, dryRun: false, setupBeyondCompare }, prompt, output);

    // Optional git-side half: apply the Unity smart-merge `.gitattributes`
    // block to the chosen project. Failures here are surfaced but do not undo
    // the Fork prefs write above.
    if (bool(record, "applyMergeAttributes")) {
      const target = str(record, "mergeTarget");
      if (!target) {
        output.log.warn("Merge attributes: no target project selected — skipped");
      } else {
        try {
          const merge = await setupMergeAttributes(target);
          if (merge.status === "skipped") {
            output.log.warn(`Merge attributes skipped: ${merge.detail}`);
          } else {
            output.log.success(`Merge attributes: ${merge.detail}`);
          }
        } catch (err: unknown) {
          output.log.error(`Merge attributes failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return result;
  },

  async git(session: HostSession, args: unknown): Promise<unknown> {
    const record = asRecord(args);
    await runGitCommand(
      {
        ignore: bool(record, "ignore"),
        exclude: bool(record, "exclude"),
        lfs: bool(record, "lfs"),
        target: str(record, "target"),
        dryRun: false,
        autoYes: false,
      },
      createGuiPrompt(session),
      createGuiOutput(session),
    );
    return null;
  },

  // --- templates: per-feature inline editor (request/response, no prompts) --
  "templates:read": templatesRead,
  "templates:write": templatesWrite,
  "templates:reset": templatesReset,

  // --- mcp: project-first, status-aware page ----------------------------
  // The renderer draws its own page (page: "mcp"): pick a project, then this
  // command reports that project's install state so the page offers only the
  // valid actions. Strictly offline — the same detectors `scvn mcp status` uses.
  async "mcp:project-status"(_session: HostSession, args: unknown): Promise<unknown> {
    const target = str(asRecord(args), "target");
    const staged = (await listStagedVersions({ userCacheDir: writeCacheDir() })).map(
      (s) => ({ version: s.version, bundled: s.source === "bundled" }),
    );
    const addonOptions = MCP_ADDON_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
    const defaultAddons = [...DEFAULT_ADDONS];
    if (!target) {
      return { installed: false, version: null, staged, addonOptions, defaultAddons } satisfies McpProjectStatus;
    }
    // The picker value is the project's Assets dir; the install marker lives at
    // the project root (Assets' parent) — the same target shape `scvn mcp` uses.
    const projectRoot = path.dirname(target);
    const installed = await isInstalled(projectRoot);
    const version = installed ? await markerVersion(projectRoot) : null;
    return { installed, version, staged, addonOptions, defaultAddons } satisfies McpProjectStatus;
  },

  async mcp(session: HostSession, args: unknown): Promise<unknown> {
    const record = asRecord(args);
    const addons = record["addons"];
    await runMcp(
      {
        verb: str(record, "verb"),
        version: str(record, "version"),
        target: str(record, "target"),
        addons: Array.isArray(addons) && addons.length > 0 ? addons.join(",") : undefined,
        dryRun: false,
        autoYes: false,
      },
      createGuiPrompt(session),
      createGuiOutput(session),
    );
    return null;
  },

  async packages(session: HostSession, args: unknown): Promise<unknown> {
    const record   = asRecord(args);
    const prompt   = createGuiPrompt(session);
    const verb     = str(record, "verb");
    const packages = strArray(record, "packages");
    const to       = strArray(record, "to");
    // The Packages page validates the picked folder (packages:resolve-source)
    // and passes it as `from`; if it somehow arrives without one, runAdd's own
    // dir prompt fires (a native folder dialog under the GUI prompt adapter).
    const wantsSource = verb === "add" || verb === "export";
    const from = wantsSource ? str(record, "from") : undefined;
    await runPackages(
      {
        verb,
        from,
        to:       to.length > 0 ? to : undefined,
        packages: packages.length > 0 ? packages : undefined,
        dryRun:   false,
        autoYes:  false,
      },
      prompt,
      createGuiOutput(session),
    );
    return null;
  },

  // --- packages page: pickers + library commands feeding the list UI ---
  // resolve-source validates a natively-picked folder to a stageable package
  // (its Assets-relative path); list returns the staged library; remove drops
  // packages from it.
  async "packages:resolve-source"(_session: HostSession, args: unknown): Promise<unknown> {
    const picked = str(asRecord(args), "picked");
    if (!picked) {
      return { status: "invalid", picked: "", message: "No folder selected" } satisfies PackagesSourceResult;
    }
    const resolved = resolveAddFolder(picked);
    if (resolved.status === "ok") {
      const { assetsDir, relPath, label } = resolved.folder;
      return { status: "ok", assetsDir, relPath, label } satisfies PackagesSourceResult;
    }
    return { status: "invalid", picked, message: resolved.message } satisfies PackagesSourceResult;
  },

  async "packages:list"(): Promise<unknown> {
    return readLibraryModel();
  },

  async "packages:remove"(_session: HostSession, args: unknown): Promise<unknown> {
    const labels = strArray(asRecord(args), "labels");
    if (labels.length === 0) return readLibraryModel();
    // Remove targets the same resolved store the list reads from (add writes the
    // user store; the resolver returns it whenever it holds packages).
    const effective = await resolveEffectiveStoreDir("packages");
    await removePackages(labels, { storeDir: effective?.storeDir });
    // Return the updated library so the renderer refreshes in one round-trip.
    return readLibraryModel();
  },

  // --- config: native form (Phase 4) -------------------------------------
  async "config:prepare"(): Promise<unknown> {
    const current = await loadConfig();
    return {
      fields: [{
        name: "projectsRoot",
        label: "Unity projects root",
        type: "text",
        kind: "dir",
        placeholder: "/path/to/your/Unity/Projects",
        default: current.projectsRoot,
      }],
    } satisfies FormModel;
  },

  async config(session: HostSession, args: unknown): Promise<unknown> {
    const record = asRecord(args);
    return runConfigExecute(
      { projectsRoot: str(record, "projectsRoot") ?? "" },
      { output: createGuiOutput(session) },
    );
  },

  async doctor(session: HostSession): Promise<unknown> {
    await runDoctor(undefined, {}, createGuiOutput(session));
    return null;
  },

  // --- ignore-dirty: live per-submodule toggle page ---------------------
  // Two request/response commands: list enumerates submodules + their local
  // and .gitmodules ignore state; set writes one submodule's local override.
  "ignore-dirty:list": ignoreDirtyList,
  "ignore-dirty:set": ignoreDirtySet,

  // --- projects:discover: the project picker's option source -------------
  // Structured rows (name / branch / age) so the renderer can lay the parts
  // out as distinct columns instead of one glued string.
  async "projects:discover"(): Promise<unknown> {
    return discoverSetupTargetsRich();
  },
};
