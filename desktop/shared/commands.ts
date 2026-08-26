/**
 * desktop/shared/commands.ts — Capability catalog + launch-arg contract.
 *
 * Single source of truth shared by the renderer (which renders a launch form
 * per capability) and the host command registry (which validates the collected
 * values and calls the matching scvn handler). Keeping this declarative lets the
 * renderer stay generic: it draws whatever `launch` fields a capability lists.
 *
 * Phase 3 model: the launch form gathers only the non-interactive flags a
 * handler needs up front; everything else (project pickers, confirmations) is
 * driven by the handler itself and surfaced as GUI controls over the prompt
 * channel. Phase 4 replaces a few of these with dedicated native forms.
 */

/** Show a field only when another field currently holds `equals`. */
export interface FieldCondition {
  field: string;
  equals: string;
}

/** A single field in a capability's launch form. */
export type LaunchField =
  | { name: string; label: string; type: "boolean"; default?: boolean; templateKey?: EditableTemplateKey; visibleWhen?: FieldCondition }
  | {
      name: string;
      label: string;
      type: "text";
      placeholder?: string;
      /** Prefilled value (e.g. the current config root). */
      default?: string;
      /** Directory/file intent — renders a native "Browse…" picker. */
      kind?: "path" | "dir";
      visibleWhen?: FieldCondition;
    }
  | {
      name: string;
      label: string;
      type: "select";
      options: { value: string; label: string }[];
      default?: string;
      visibleWhen?: FieldCondition;
    }
  | {
      name: string;
      label: string;
      type: "multiselect";
      options: { value: string; label: string }[];
      default?: string[];
      visibleWhen?: FieldCondition;
    }
  | {
      name: string;
      label: string;
      type: "project";
      /** Prefilled Assets path. */
      default?: string;
      visibleWhen?: FieldCondition;
    };

/** Declarative description of one scvn capability. */
export interface CapabilitySpec {
  /** Registry key + invoke command. */
  id: string;
  label: string;
  description: string;
  /**
   * Phase-4 native form: when true the renderer invokes `<id>:prepare` for a
   * `FormModel` (dynamic fields/options), renders it as one screen, and submit
   * runs the `<id>` execute handler with the collected values. When false the
   * `launch` fields are gathered up front and the handler drives any further
   * prompts over the prompt channel (Phase-3 guided-dialog).
   */
  form?: boolean;
  /** Fields gathered before the flow starts (may be empty → runs immediately). */
  launch: LaunchField[];
  /**
   * A dedicated renderer view instead of the generic launch form: "git" draws
   * the per-op action list plus the live per-submodule ignore=dirty toggles,
   * "settings" the Config/Doctor tabs, "packages" the Export/Import library, and
   * "mcp" the project-first, status-aware MCP page. Omitted → form.
   */
  page?: "git" | "settings" | "packages" | "mcp";
}

/**
 * Model returned by a form capability's `<id>:prepare` command: the fields to
 * render (with dynamic options/defaults resolved), an optional intro note, and
 * a blocker message that, when present, disables submit (unmet prerequisites).
 */
export interface FormModel {
  fields: LaunchField[];
  note?: string;
  blocker?: string;
}

/** Collected launch-form values, keyed by field name. */
export type LaunchValues = Record<string, string | boolean | string[] | undefined>;

// ---------------------------------------------------------------------------
// Editable git-artifact templates (per-feature inline editor)
// ---------------------------------------------------------------------------

/** The four git artifacts editable inline (Git setup ops + the Fork merge block). */
export type EditableTemplateKey =
  | "gitignore"
  | "gitexclude"
  | "gitattributesLfs"
  | "gitattributesMerge";

/**
 * The set the host accepts for read/write/reset. Keys match the CLI TemplateKey
 * names so the host maps them straight through resolveTemplateKey and derives
 * each filename from templateFilename(key) — no duplicated filename table.
 */
export const EDITABLE_TEMPLATE_KEYS: EditableTemplateKey[] = [
  "gitignore",
  "gitexclude",
  "gitattributesLfs",
  "gitattributesMerge",
];

/** Effective + bundled-default content for one template (read handler payload). */
export interface TemplateContent {
  key: EditableTemplateKey;
  filename: string;
  /** Effective content: the override if present, else the bundled default. */
  content: string;
  /** The bundled default, always — used to show what "reset" would restore. */
  defaultContent: string;
  isOverridden: boolean;
}

// ---------------------------------------------------------------------------
// Ignore-dirty page (live per-submodule toggle list)
// ---------------------------------------------------------------------------

/** One submodule row in the Ignore-dirty page (payload of `ignore-dirty:list`). */
export interface SubmoduleIgnoreRow {
  /** `.gitmodules` section name — git resolves `submodule.<name>.ignore` by this. */
  name: string;
  /** Working-tree path — the row's display label. */
  path: string;
  /** True when local `.git/config` sets `ignore=dirty` — what the toggle controls. */
  localDirty: boolean;
  /** The `.gitmodules` `ignore` value if declared there (`dirty`/`all`/…), else null. Read-only context. */
  gitmodulesIgnore: string | null;
}

/** Result of the `ignore-dirty:list` command for a chosen target. */
export type SubmoduleIgnoreList =
  | { status: "notRepo"; target: string }
  | { status: "noSubmodules"; repo: string }
  | { status: "ok"; repo: string; submodules: SubmoduleIgnoreRow[] };

// ---------------------------------------------------------------------------
// Packages page (one library: add a folder, remove, import)
// ---------------------------------------------------------------------------

/**
 * Payload of `packages:resolve-source`: a picked folder validated to a stageable
 * package. `ok` carries the resolved Assets dir, its Assets-relative path, and
 * the derived label; `invalid` carries a user-facing reason.
 */
export type PackagesSourceResult =
  | { status: "ok"; assetsDir: string; relPath: string; label: string }
  | { status: "invalid"; picked: string; message: string };

/** One row in the staged package library (payload of `packages:list`). */
export interface PackageLibraryRow {
  label: string;
  relPath: string;
  /** Human-readable per-package provenance (source @ branch · age · size). */
  provenance: string;
  /** Absolute Assets dir this package was staged from. */
  sourcePath: string;
  bytes: number;
}

/** Payload of `packages:list` / `packages:remove`: the current library. */
export interface PackagesLibraryModel {
  packages: PackageLibraryRow[];
}

// ---------------------------------------------------------------------------
// MCP page (project-first, status-aware actions)
// ---------------------------------------------------------------------------

/** One core version staged locally and installable without a network fetch. */
export interface McpStagedVersion {
  version: string;
  /** Came from the bundled cache (shipped with scvn) rather than the user cache. */
  bundled: boolean;
}

/**
 * Per-target MCP state (payload of `mcp:project-status`): whether the chosen
 * project has MCP vendored and at which version, the versions staged locally
 * (newest-first — the first is the install/update target), and the addon catalog
 * the install action offers. Strictly offline — no registry round-trip — so the
 * page can gate its actions the instant a project is picked.
 */
export interface McpProjectStatus {
  installed: boolean;
  /** Installed core version, or null when not installed / unparseable. */
  version: string | null;
  staged: McpStagedVersion[];
  addonOptions: { value: string; label: string }[];
  defaultAddons: string[];
}

/**
 * Build-time tab selection. `SCVN_TABS` (comma-separated capability ids) is
 * injected as the `__SCVN_TABS__` constant by both bundlers (vite + tsup); an
 * unset/empty value ships every tab. The `typeof` guard keeps this safe under
 * tsx/vitest where no define is applied, falling back to `process.env`.
 */
declare const __SCVN_TABS__: string | undefined;

function resolveTabsEnv(): string {
  if (typeof __SCVN_TABS__ === "string") return __SCVN_TABS__;
  if (typeof process !== "undefined") return process.env.SCVN_TABS ?? "";
  return "";
}

/** Parse a raw `SCVN_TABS` value into an id list, or null when none is set. */
export function parseTabSelection(raw: string): string[] | null {
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : null;
}

/**
 * Filter the full catalog to a selection, preserving menu order. An empty or
 * absent selection returns every capability. Pure — the build-time source is
 * applied by `CAPABILITIES` below.
 */
export function filterCapabilities(all: CapabilitySpec[], raw: string): CapabilitySpec[] {
  const sel = parseTabSelection(raw);
  if (!sel) return all;
  const enabled = new Set(sel);
  return all.filter((c) => enabled.has(c.id));
}

/** The full capability catalog, in menu order. */
export const ALL_CAPABILITIES: CapabilitySpec[] = [
  {
    id: "fork",
    label: "Fork",
    description: "Configure Fork.app for Unity YAML merges (Beyond Compare + editor).",
    form: true,
    launch: [],
  },
  {
    id: "git",
    label: "Git setup",
    description:
      "Install .gitignore, .git/info/exclude, and/or Git LFS, and toggle ignore=dirty per submodule.",
    page: "git",
    launch: [],
  },
  {
    id: "mcp",
    label: "MCP",
    description: "Manage the Unity MCP integration in a project (status/install/update/uninstall).",
    page: "mcp",
    launch: [],
  },
  {
    id: "packages",
    label: "Packages",
    description: "Manage a library of packages: add from a source project, remove, and import into a target.",
    page: "packages",
    launch: [],
  },
  {
    id: "settings",
    label: "Settings",
    description: "scvn configuration and environment checks.",
    page: "settings",
    launch: [],
  },
];

/**
 * The capabilities this build ships, in menu order. When `SCVN_TABS` selects a
 * subset, only those tabs render (renderer) and their commands register (host);
 * every other tab is hidden and not invokable.
 */
export const CAPABILITIES: CapabilitySpec[] = filterCapabilities(ALL_CAPABILITIES, resolveTabsEnv());

