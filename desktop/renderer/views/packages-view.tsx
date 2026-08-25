/**
 * desktop/renderer/views/packages-view.tsx — The Packages page (library).
 *
 * A single list of staged packages (the library). From here the user can:
 *   - Add packages from a source project (stages into the library, accumulating)
 *   - Remove a package from the library
 *   - Select packages and import them into a target project
 *
 * Add and Import run through the streaming run overlay (they copy bytes); Remove
 * is a fast request/response host command that returns the updated library. The
 * page reloads its list on mount — App remounts it after a packages run returns,
 * so a completed Add/Import is reflected without a manual refresh.
 */

import * as React from "react";
import {
  Download,
  FolderOpen,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { invokeForResult, pickDirectory } from "@/lib/bridge";
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

function Spinner({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function PackagesView({ onRun }: PackagesViewProps): React.JSX.Element {
  const [library, setLibrary] = React.useState<PackageLibraryRow[] | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [target, setTarget] = React.useState("");
  const [addNotice, setAddNotice] = React.useState<string | null>(null);
  const [resolving, setResolving] = React.useState(false);
  const [busyLabel, setBusyLabel] = React.useState<string | null>(null);

  const applyLibrary = React.useCallback((rows: PackageLibraryRow[]) => {
    setLibrary(rows);
    const present = new Set(rows.map((r) => r.label));
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
        setSelected(rows.map((r) => r.label));
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applyLibrary]);

  // The + / Add affordance opens the OS folder picker directly. A folder that
  // resolves to a package inside a Unity Assets/ runs the add immediately; a bad
  // pick surfaces an inline notice; cancelling the dialog leaves the page as is.
  const beginAdd = React.useCallback(() => {
    setAddNotice(null);
    setResolving(true);
    void pickDirectory({
      kind: "dir",
      title: "Select a folder inside a Unity project's Assets/ to add",
    })
      .then(async (chosen) => {
        if (chosen === null) return;
        const raw = await invokeForResult("packages:resolve-source", {
          picked: chosen,
        });
        const result = raw as PackagesSourceResult;
        if (result.status === "ok") onRun("packages", { verb: "add", from: chosen });
        else setAddNotice(result.message);
      })
      .catch((err: unknown) =>
        setAddNotice(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setResolving(false));
  }, [onRun]);

  const removeOne = React.useCallback(
    (label: string) => {
      if (!window.confirm(`Remove "${label}" from the library?`)) return;
      setBusyLabel(label);
      void invokeForResult("packages:remove", { labels: [label] })
        .then((raw) => applyLibrary((raw as PackagesLibraryModel).packages))
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => setBusyLabel(null));
    },
    [applyLibrary],
  );

  const toggleSelect = React.useCallback((label: string) => {
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
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
    setSelected(allSelected ? [] : library.map((r) => r.label));
  const canImport = target !== "" && selected.length > 0;
  const hasLibrary = library.length > 0;

  return (
    <div className="mx-auto w-full max-w-[640px] p-6">
      <Card>
        {hasLibrary ? (
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
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
          </CardHeader>
        ) : null}

        <CardContent className="space-y-3">
          {addNotice ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {addNotice}
            </p>
          ) : null}

          {hasLibrary ? (
            <>
              <div className="space-y-2">
                {library.map((row, i) => {
                  const id = `lib-${row.label}`;
                  const checked = selected.includes(row.label);
                  return (
                    <div
                      key={row.label}
                      data-selected={checked || undefined}
                      style={{ animationDelay: `${i * 40}ms` }}
                      className="flex animate-in fade-in-0 slide-in-from-top-1 fill-mode-both items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-150 ease-[var(--ease-out)] hover:bg-muted/40 data-[selected]:border-primary/50 data-[selected]:bg-primary/5"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggleSelect(row.label)}
                      />
                      <label
                        htmlFor={id}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <span className="block truncate font-medium">
                          {row.label}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.provenance}
                        </span>
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${row.label}`}
                        disabled={busyLabel !== null}
                        onClick={() => removeOne(row.label)}
                      >
                        {busyLabel === row.label ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <ProjectControl
                  id="import-target"
                  label="Import into a project"
                  value={target}
                  onChange={setTarget}
                />
                <div className="flex justify-end">
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
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderOpen className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">No packages staged yet</p>
                <p className="text-sm text-muted-foreground">
                  Pick a folder inside a Unity project's Assets/ to add to the library.
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
