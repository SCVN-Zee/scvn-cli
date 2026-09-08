/**
 * desktop/renderer/views/packages-view.tsx — The Packages page (library).
 *
 * A single list of staged packages (the library), grouped by
 * project-root-relative path so you can see where each package lives
 * (Assets/..., Packages/..., or custom root folders). From here the user can:
 *   - Add packages from a source project (stages into the library, accumulating)
 *   - Remove a package from the library
 *   - Select packages (or a whole folder) and import them into a target project
 *
 * Add and Import run through the streaming run overlay (they copy bytes); Remove
 * is a fast request/response host command that returns the updated library. The
 * page reloads its list on mount — App remounts it after a packages run returns,
 * so a completed Add/Import is reflected without a manual refresh.
 */

import * as React from "react";
import {
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { invokeForResult, pickDirectories } from "@/lib/bridge";
import {
  buildPackageTree,
  collectPackageRelPaths,
  allFolderPaths,
  type PackageTreeNode,
} from "@/lib/package-tree";
import { cn } from "@/lib/utils";
import { ProjectControl } from "@/views/capability-form";
import type {
  LaunchValues,
  PackageLibraryRow,
  PackagesLibraryModel,
  PackagesSourceResult,
} from "@shared/commands";

export interface PackagesViewProps {
  onRun: (capabilityId: string, values: LaunchValues) => void;
}

/**
 * The rendered tree mirrors project-root-relative identities directly: top
 * level shows `Assets/`, `Packages/`, and custom root folders, so no synthetic
 * root node is needed.
 */

function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function ChevronToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
      onClick={onToggle}
      className="flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none transition-[color,background-color] duration-150 ease-[var(--ease-out)] hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
    >
      <ChevronRight
        className={cn(
          "size-3 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-[var(--ease-out)]",
          open && "rotate-90",
        )}
      />
    </button>
  );
}

function PackageRow({
  row,
  checked,
  busy,
  hasChildren,
  open,
  onToggle,
  onToggleExpand,
  onRemove,
}: {
  row: PackageLibraryRow;
  checked: boolean;
  busy: boolean;
  hasChildren: boolean;
  open: boolean;
  onToggle: () => void;
  onToggleExpand: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const id = `lib-${row.relPath.replace(/[/\\]/g, "-")}`;
  return (
    <div
      data-selected={checked || undefined}
      data-path={row.relPath}
      className="group flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm transition-[color,background-color] duration-150 ease-[var(--ease-out)] hover:bg-muted/50 data-[selected]:bg-primary/5"
    >
      {hasChildren ? (
        <ChevronToggle open={open} label={row.label} onToggle={onToggleExpand} />
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}
      <Checkbox id={id} checked={checked} onCheckedChange={onToggle} />
      <label
        htmlFor={id}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
      >
        <span className="min-w-0 truncate font-medium leading-none">
          {row.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs leading-none text-muted-foreground">
          {row.provenance}
        </span>
      </label>
      <button
        type="button"
        aria-label={`Remove ${row.label}`}
        disabled={busy}
        onClick={onRemove}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:opacity-50"
      >
        {busy ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function FolderRow({
  node,
  selected,
  open,
  onToggleExpand,
  onToggleFolder,
}: {
  node: PackageTreeNode<PackageLibraryRow>;
  selected: string[];
  open: boolean;
  onToggleExpand: () => void;
  onToggleFolder: (relPaths: string[], selectAll: boolean) => void;
}): React.JSX.Element {
  const relPaths = collectPackageRelPaths(node);
  const selectedCount = relPaths.filter((r) => selected.includes(r)).length;
  const checked = relPaths.length > 0 && selectedCount === relPaths.length;
  const indeterminate = selectedCount > 0 && !checked;
  const id = `lib-folder-${node.path.replace(/[/\\]/g, "-")}`;

  return (
    <div className="flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted/50">
      <ChevronToggle open={open} label={node.name} onToggle={onToggleExpand} />
      <Checkbox
        id={id}
        checked={checked}
        indeterminate={indeterminate}
        onCheckedChange={(next) => onToggleFolder(relPaths, next)}
      />
      <button
        type="button"
        onClick={onToggleExpand}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none select-none focus-visible:text-foreground"
      >
        {open ? (
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{node.name}</span>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          · {relPaths.length}
        </span>
      </button>
    </div>
  );
}

function TreeList({
  nodes,
  selected,
  expanded,
  busyRelPath,
  depth,
  onToggle,
  onToggleFolder,
  onToggleExpand,
  onRemove,
}: {
  nodes: PackageTreeNode<PackageLibraryRow>[];
  selected: string[];
  expanded: ReadonlySet<string>;
  busyRelPath: string | null;
  depth: number;
  onToggle: (relPath: string) => void;
  onToggleFolder: (relPaths: string[], selectAll: boolean) => void;
  onToggleExpand: (path: string) => void;
  onRemove: (relPath: string) => void;
}): React.JSX.Element {
  return (
    <ul
      className={cn(
        "space-y-px",
        depth > 0 && "ml-2.5 border-l border-border/70 pl-2.5",
      )}
    >
      {nodes.map((node, i) => {
        const hasChildren = node.children.length > 0;
        const open = hasChildren && expanded.has(node.path);
        return (
          <li
            key={node.path}
            style={
              depth === 0
                ? { animationDelay: `${Math.min(i, 6) * 30}ms` }
                : undefined
            }
            className={
              depth === 0
                ? "animate-in fade-in-0 slide-in-from-top-1 fill-mode-both"
                : undefined
            }
          >
            {node.pkg ? (
              <PackageRow
                row={node.pkg}
                checked={selected.includes(node.pkg.relPath)}
                busy={busyRelPath === node.pkg.relPath}
                hasChildren={hasChildren}
                open={open}
                onToggle={() => onToggle(node.pkg!.relPath)}
                onToggleExpand={() => onToggleExpand(node.path)}
                onRemove={() => onRemove(node.pkg!.relPath)}
              />
            ) : (
              <FolderRow
                node={node}
                selected={selected}
                open={open}
                onToggleExpand={() => onToggleExpand(node.path)}
                onToggleFolder={onToggleFolder}
              />
            )}
            {open ? (
              <TreeList
                nodes={node.children}
                selected={selected}
                expanded={expanded}
                busyRelPath={busyRelPath}
                depth={depth + 1}
                onToggle={onToggle}
                onToggleFolder={onToggleFolder}
                onToggleExpand={onToggleExpand}
                onRemove={onRemove}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function PackagesView({ onRun }: PackagesViewProps): React.JSX.Element {
  const [library, setLibrary] = React.useState<PackageLibraryRow[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [target, setTarget] = React.useState("");
  const [addNotice, setAddNotice] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [busyRelPath, setBusyRelPath] = React.useState<string | null>(null);

  const applyLibrary = React.useCallback((rows: PackageLibraryRow[]) => {
    setLibrary(rows);
    const present = new Set(rows.map((r) => r.relPath));
    setSelected((prev) => prev.filter((l) => present.has(l)));
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void invokeForResult("packages:list")
      .then((raw) => {
        if (cancelled) return;
        // Select every staged package by default; the user opts out per-row.
        const rows = (raw as PackagesLibraryModel).packages;
        setLibrary(rows);
        setSelected(rows.map((r) => r.relPath));
        setExpanded(new Set(allFolderPaths(buildPackageTree(rows))));
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applyLibrary]);

  // The tree mirrors project-root-relative relPaths: `Assets/`, `Packages/`,
  // and custom root folders appear as top-level nodes.
  const tree = React.useMemo<PackageTreeNode<PackageLibraryRow>[]>(
    () => (library === null ? [] : buildPackageTree(library)),
    [library],
  );

  // The + / Add affordance opens the OS folder picker (multi-select) directly.
  // Every pick is validated (packages:resolve-source); a pick set that resolves
  // to packages inside a Unity project runs one add for all of them. A set with
  // no valid pick surfaces an inline notice; cancelling leaves the page as is.
  const beginAdd = React.useCallback(() => {
    setAddNotice(null);
    setResolving(true);
    void pickDirectories({
      kind: "dir",
      title: "Select package folders inside a Unity project to add",
    })
      .then(async (chosen) => {
        if (chosen === null || chosen.length === 0) return;
        // Validate every picked folder before a run starts. A multi-select
        // dialog picks siblings sharing one project, so picks
        // normally resolve together; the per-folder partition is the safety
        // net for anything else the host rejects. (The ok result carries no
        // path — pair each pick with its outcome here.)
        const valid: string[] = [];
        const invalidMessages: string[] = [];
        for (const picked of chosen) {
          try {
            const raw = await invokeForResult("packages:resolve-source", { picked });
            const result = raw as PackagesSourceResult;
            if (result.status === "ok") valid.push(picked);
            else invalidMessages.push(result.message);
          } catch (err) {
            invalidMessages.push(err instanceof Error ? err.message : String(err));
          }
        }
        if (valid.length === 0) {
          setAddNotice(invalidMessages.join("\n"));
          return;
        }
        onRun("packages", { verb: "add", from: valid });
      })
      .catch((err: unknown) =>
        setAddNotice(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setResolving(false));
  }, [onRun]);

  const removeOne = React.useCallback(
    (relPath: string) => {
      const row = library?.find((r) => r.relPath === relPath);
      const name = row?.label ?? relPath;
      if (!window.confirm(`Remove "${name}" from the library?`)) return;
      setBusyRelPath(relPath);
      void invokeForResult("packages:remove", { relPaths: [relPath] })
        .then((raw) => applyLibrary((raw as PackagesLibraryModel).packages))
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => setBusyRelPath(null));
    },
    [applyLibrary, library],
  );

  const toggleSelect = React.useCallback((relPath: string) => {
    setSelected((prev) =>
      prev.includes(relPath) ? prev.filter((r) => r !== relPath) : [...prev, relPath],
    );
  }, []);

  const toggleFolder = React.useCallback(
    (relPaths: string[], selectAll: boolean) => {
      setSelected((prev) => {
        if (!selectAll) return prev.filter((r) => !relPaths.includes(r));
        const next = new Set(prev);
        for (const relPath of relPaths) next.add(relPath);
        return [...next];
      });
    },
    [],
  );

  const toggleExpand = React.useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (library === null)
    return (
      <div className="p-6">
        <Spinner label="Reading package library…" />
      </div>
    );

  const allSelected = library.length > 0 && selected.length === library.length;
  const someSelected = selected.length > 0 && !allSelected;
  const toggleAll = () =>
    setSelected(allSelected ? [] : library.map((r) => r.relPath));
  const canImport = target !== "" && selected.length > 0;
  const hasLibrary = library.length > 0;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col p-6">
      <Card className="min-h-0 flex-1 gap-4 overflow-hidden py-4">
        {hasLibrary ? (
          <CardHeader className="shrink-0 items-center">
            <label
              htmlFor="lib-select-all"
              className="flex cursor-pointer items-center gap-2.5 text-sm font-medium select-none"
            >
              <Checkbox
                id="lib-select-all"
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={toggleAll}
              />
              <span>
                {selected.length} of {library.length} selected
              </span>
            </label>
            <CardAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={resolving}
                onClick={beginAdd}
              >
                {resolving ? <LoaderCircle className="animate-spin" /> : <Plus />}
                Add package
              </Button>
            </CardAction>
          </CardHeader>
        ) : null}

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
          {addNotice ? (
            <p className="shrink-0 whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {addNotice}
            </p>
          ) : null}

          {hasLibrary ? (
            <>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-2">
                <TreeList
                  nodes={tree}
                  selected={selected}
                  expanded={expanded}
                  busyRelPath={busyRelPath}
                  depth={0}
                  onToggle={toggleSelect}
                  onToggleFolder={toggleFolder}
                  onToggleExpand={toggleExpand}
                  onRemove={removeOne}
                />
              </div>

              <div className="shrink-0 rounded-lg border bg-muted/30 p-4">
                <ProjectControl
                  id="import-target"
                  label="Import into a project"
                  value={target}
                  onChange={setTarget}
                  action={
                    <Button
                      type="button"
                      disabled={!canImport}
                      onClick={() =>
                        onRun("packages", {
                          verb: "import",
                          to: [target],
                          packages: selected,
                        })
                      }
                    >
                      <Download />
                      Import
                      {selected.length > 0
                        ? ` ${selected.length} package${selected.length === 1 ? "" : "s"}`
                        : ""}
                    </Button>
                  }
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderOpen className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No packages staged yet</p>
                <p className="text-sm text-muted-foreground">
                  Pick package folders inside a Unity project — under Assets/, Packages/, or the project root — to add to the library.
                </p>
              </div>
              <Button type="button" disabled={resolving} onClick={beginAdd}>
                {resolving ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Plus />
                )}
                Add packages
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
