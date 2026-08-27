/**
 * commands/packages.ts — Linear clack flow for `scvn packages add|remove|import`.
 *
 * The store is a LIBRARY of staged packages:
 *   add:    pick a folder inside a Unity project (Assets/, Packages/, or a
 *           custom root folder) → size confirm (in
 *           feature) → copy it into the store library, MERGING with what is
 *           already staged (`export` is a back-compat alias for `add`).
 *   remove: pick staged packages (nothing preselected) → confirm → delete each
 *           package's mirror + sidecar + meta entry.
 *   import: per-package provenance → multiselect staged packages (default all) →
 *           target select → ONE summary confirm → apply (+ dangling-.meta cleanup
 *           confirm inside the feature).
 *
 * `-y` rules: add needs --from (the folder); import requires --to; remove
 * requires --packages (never bulk-wipes).
 */

import process from "node:process";
import { realOutput } from "../ui/output.js";
import type { OutputAdapter } from "../ui/output.js";
import { realPrompt } from "../ui/prompt.js";
import type { PromptAdapter } from "../ui/prompt.js";
import { appendHistory } from "../util/history.js";
import { exportPackages, importPackages, removePackages, resolveAddFolder, type PackageSpec, type ResolvedAddFolder } from "../features/packages/index.js";
import { readPackagesStoreMeta, formatPackageProvenance, resolveEffectiveStoreDir } from "../features/store/index.js";
import type { StagedPackage } from "../features/store/index.js";
import { runStep } from "./shared/step-runner.js";
import { selectTargetProjects, UsageError } from "./shared/select-target-projects.js";
import { confirmImportSummary } from "./shared/confirm-import-summary.js";
import { selectStagedPackages, selectStagedPackagesToRemove } from "./shared/select-packages.js";
import { clackConfirm } from "./shared/clack-confirm.js";
import { deriveProjectName, shortenPath } from "../util/paths.js";
import path from "node:path";
import { isDir } from "../util/fs-predicates.js";

export interface PackagesArgs {
  verb?:    string;     // "add" | "remove" | "import" | "export" (alias) | undefined (menu)
  from?:    string | string[]; // --from <path> / desktop multi-pick (folder(s) to add)
  to?:      string[];   // --to <path> (import targets, repeatable)
  store?:   string;     // --store <path> (snapshot-store dir override)
  packages?: string[]; // pre-selected package relPaths (desktop page / -y); skips the picker
  dryRun?:  boolean;
  autoYes?: boolean;
}

type PackagesVerb = "add" | "remove" | "import";

/** "export" is a back-compat alias for "add". */
function normalizeVerb(verb: string | undefined): PackagesVerb | undefined {
  if (verb === "export" || verb === "add") return "add";
  if (verb === "remove") return "remove";
  if (verb === "import") return "import";
  return undefined;
}

async function resolveVerb(args: PackagesArgs, prompt: PromptAdapter): Promise<PackagesVerb> {
  const explicit = normalizeVerb(args.verb);
  if (explicit) return explicit;
  return prompt.select<PackagesVerb>({
    message: "packages: which operation?",
    options: [
      { value: "add",    label: "Add",    hint: "Stage packages from a source project into the library" },
      { value: "remove", label: "Remove", hint: "Remove staged packages from the library" },
      { value: "import", label: "Import", hint: "Apply staged packages to a target project" },
    ],
  });
}

async function runAdd(args: PackagesArgs, prompt: PromptAdapter, output: OutputAdapter): Promise<void> {
  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;

  // Pick ONE or MORE folders inside a Unity project to stage into the library —
  // Assets/ content, embedded UPM packages, or custom root-level folders; the
  // desktop picker selects several siblings at once.
  const picked = args.from ?? await prompt.text({
    message: "Select a folder inside a Unity project to add",
    kind:    "dir",
  });
  const picks = Array.isArray(picked) ? picked : [picked];
  if (args.from) for (const p of picks) output.log.step(`add: ${shortenPath(p)}  (--from)`);

  // Validate EVERY pick before staging any — all-or-nothing, matching the
  // single-folder semantics. A --from / text-prompt path can be a typo or
  // relative; the native desktop dialog guarantees existence, but
  // resolveAddFolder does the ProjectVersion.txt walk-up only after this
  // precheck, so a bad path would stage a bogus package and only fail
  // mid-rsync. Resolve to absolute and require a real directory first.
  const resolved: ResolvedAddFolder[] = [];
  for (const p of picks) {
    const abs = path.resolve(p);
    if (!(await isDir(abs))) {
      output.log.error(`${shortenPath(p)} is not an existing folder`);
      process.exitCode = 1;
      output.outro("packages add: invalid folder");
      return;
    }
    const result = await resolveAddFolder(abs);
    if (result.status !== "ok") {
      output.log.error(result.message);
      process.exitCode = 1;
      output.outro("packages add: invalid folder");
      return;
    }
    resolved.push(result.folder);
  }

  // Stage per source project root: a dialog multi-select picks siblings
  // sharing one project, but `from` may span projects, and exportPackages
  // mirrors from a single src root per call.
  const byProjectRoot = new Map<string, PackageSpec[]>();
  for (const { projectRoot, ...spec } of resolved) {
    const specs = byProjectRoot.get(projectRoot) ?? [];
    specs.push(spec);
    byProjectRoot.set(projectRoot, specs);
  }

  let failed = false;
  let doneCount = 0; // packages staged (or would-be, on dry-run)
  for (const [projectRoot, specs] of byProjectRoot) {
    const outcome = await runStep({
      key:   "packages-add",
      label: specs.length === 1 ? "Add Package" : `Add ${specs.length} Packages`,
      dryRun,
      run:   (reporter, cfm) => exportPackages(projectRoot, specs, { dryRun, reporter, confirm: cfm, storeDir: args.store }),
    }, prompt, clackConfirm(prompt, autoYes), output);

    if (outcome === "failed") failed = true;
    else if (outcome === "done") {
      doneCount += specs.length;
      if (!dryRun) {
        await appendHistory({
          ts:     new Date().toISOString(),
          kind:   "add",
          src:    projectRoot,
          step:   "packages",
          status: "ok",
        }).catch(() => { /* best-effort */ });
      }
    }
  }

  if (failed) {
    process.exitCode = 1;
    output.outro("packages add: failed");
  } else if (doneCount > 0) {
    output.outro(dryRun
      ? "packages add: dry-run complete (no writes)"
      : `packages add: staged ${doneCount} package${doneCount === 1 ? "" : "s"}`);
  } else {
    output.outro("packages add: aborted");
  }
}

async function runRemove(args: PackagesArgs, prompt: PromptAdapter, output: OutputAdapter): Promise<void> {
  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;

  const effective = await resolveEffectiveStoreDir("packages", { override: args.store });
  const meta = await readPackagesStoreMeta(effective?.storeDir);
  if (!meta || meta.packages.length === 0) {
    output.log.error("Nothing staged — run `scvn packages add` first");
    process.exitCode = 1;
    output.outro("packages remove: nothing staged");
    return;
  }

  // -y never bulk-wipes: an explicit --packages selection is required.
  if (autoYes && !args.packages) {
    output.log.error("--yes remove requires explicit --packages <relPaths> (refusing to bulk-remove)");
    process.exitCode = 1;
    output.outro("packages remove: aborted");
    return;
  }

  const selected = await selectStagedPackagesToRemove(meta, prompt, args.packages);
  if (selected.length === 0) {
    output.log.warn("No packages selected — nothing to remove");
    output.outro("packages remove: nothing to do");
    return;
  }

  const outcome = await runStep({
    key:   "packages-remove",
    label: "Remove Packages",
    dryRun,
    run:   (reporter, cfm) => removePackages(
      selected.map((p) => p.relPath),
      { dryRun, reporter, confirm: cfm, storeDir: effective?.storeDir },
    ),
  }, prompt, clackConfirm(prompt, autoYes), output);

  if (outcome === "done" && !dryRun) {
    await appendHistory({
      ts:     new Date().toISOString(),
      kind:   "remove",
      step:   "packages",
      status: "ok",
    }).catch(() => { /* best-effort */ });
  }

  if (outcome === "failed") {
    process.exitCode = 1;
    output.outro("packages remove: failed");
  } else if (outcome === "skipped") {
    output.outro("packages remove: aborted");
  } else {
    output.outro(dryRun ? "packages remove: dry-run complete (no writes)" : "packages remove: done");
  }
}

async function runImport(args: PackagesArgs, prompt: PromptAdapter, output: OutputAdapter): Promise<void> {
  const dryRun  = args.dryRun  ?? false;
  const autoYes = args.autoYes ?? false;

  // Resolve ONE effective store (user store, else CLI-bundled) and thread it to
  // both the provenance read and the per-target handler so they never disagree.
  const effective = await resolveEffectiveStoreDir("packages", { override: args.store });
  const meta = await readPackagesStoreMeta(effective?.storeDir);
  if (!meta || meta.packages.length === 0) {
    output.log.error("Nothing staged — run `scvn packages add` first");
    process.exitCode = 1;
    output.outro("packages import: nothing staged");
    return;
  }

  output.log.step("staged library:");
  for (const pkg of meta.packages) {
    output.log.info(`  ${pkg.label} — ${formatPackageProvenance(pkg)}`);
  }

  const selected = await selectStagedPackages(meta, autoYes, prompt, args.packages);
  if (selected.length === 0) {
    output.log.warn("No packages selected — nothing to import");
    output.outro("packages import: nothing to do");
    return;
  }

  // Packages may come from several source projects; never offer any of them as
  // an overwrite target.
  const sources = [...new Set(selected.map((p) => p.sourcePath))];
  let targets: string[];
  try {
    targets = await selectTargetProjects(prompt, output, {
      to:           args.to,
      excludePaths: sources,
      autoYes,
    });
  } catch (err: unknown) {
    if (err instanceof UsageError) {
      output.log.error(err.message);
      process.exitCode = 1;
      output.outro("packages import: aborted");
      return;
    }
    throw err;
  }

  const ok = await confirmImportSummary(prompt, {
    title:      `Import ${selected.length} package(s) into ${deriveProjectName(targets[0]!)}?`,
    provenance: selected.map((p) => `${p.label} (${formatPackageProvenance(p)})`).join("; "),
    targets,
    rels:       selected.map((p) => p.relPath),
    autoYes,
  });

  if (!ok) {
    output.outro("packages import: aborted");
    return;
  }

  // The dangling-.meta cleanup inside the feature gates on this confirm fn
  const cleanupConfirm = clackConfirm(prompt, autoYes);

  let anyFailed = false;
  for (const target of targets) {
    const outcome = await runStep({
      key:   "packages-import",
      label: `Import Packages → ${deriveProjectName(target)}`,
      dryRun,
      run:   (reporter, cfm) => importPackages(target, selected, { dryRun, reporter, confirm: cfm, storeDir: effective?.storeDir }),
    }, prompt, cleanupConfirm, output);

    if (outcome === "done" && !dryRun) {
      await appendHistory({
        ts:     new Date().toISOString(),
        kind:   "import",
        src:    sources[0],
        target,
        step:   "packages",
        status: "ok",
      }).catch(() => { /* best-effort */ });
    }
    if (outcome === "failed") anyFailed = true;
  }

  if (anyFailed) {
    process.exitCode = 1;
    output.outro("packages import: completed with errors");
  } else {
    output.outro(dryRun ? "packages import: dry-run complete (no writes)" : "packages import: done");
  }
}

/**
 * Run the packages command as a linear clack flow.
 * Accepts an optional `prompt` override for testing (fake adapter).
 */
export async function runPackages(
  args: PackagesArgs,
  prompt: PromptAdapter = realPrompt,
  output: OutputAdapter = realOutput,
): Promise<void> {
  output.intro("scvn packages");
  const verb = await resolveVerb(args, prompt);
  if      (verb === "add")    await runAdd(args, prompt, output);
  else if (verb === "remove") await runRemove(args, prompt, output);
  else                        await runImport(args, prompt, output);
}
