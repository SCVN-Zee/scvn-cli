/**
 * desktop/renderer/views/git-view.tsx — The Git setup page.
 *
 * One shared target (discovered-project dropdown + Browse) at the top drives
 * everything below:
 *  - a row per git op (ignore / exclude / lfs); each runs on its own button —
 *    no toggle-then-run — and carries a pen icon to edit that op's template
 *    inline. Running an op navigates to the streaming run view via `onRun` with
 *    just that op's flag set.
 *  - a live per-submodule `ignore=dirty` toggle list. Selecting a project
 *    auto-loads every submodule in its repo (`ignore-dirty:list`); flipping a
 *    toggle applies immediately (`ignore-dirty:set`) — the write lands in the
 *    repo's local `.git/config` only, byte-identical to `scvn ignore-dirty`,
 *    never the tracked `.gitmodules`.
 *
 * When a submodule already declares `ignore = dirty` (or `all`) in
 * `.gitmodules`, git ignores its dirty content regardless of the local
 * override, so the row carries a read-only "also ignored via .gitmodules" note —
 * the toggle still reflects and controls only the local override.
 */

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ProjectControl } from "@/views/capability-form";
import { invokeForResult } from "@/lib/bridge";
import type {
  EditableTemplateKey,
  LaunchValues,
  SubmoduleIgnoreList,
  SubmoduleIgnoreRow,
} from "@shared/commands";

export interface GitViewProps {
  onRun: (capabilityId: string, values: LaunchValues) => void;
  onEditTemplate: (key: EditableTemplateKey) => void;
}

interface GitOpSpec {
  flag: "ignore" | "exclude" | "lfs";
  label: string;
  description: string;
  templateKey: EditableTemplateKey;
}

const GIT_OPS: GitOpSpec[] = [
  {
    flag: "ignore",
    label: "Install .gitignore",
    description: "Write the repo-root .gitignore and prune nested ones.",
    templateKey: "gitignore",
  },
  {
    flag: "exclude",
    label: "Install .git/info/exclude",
    description: "Write the local, unshared exclude file.",
    templateKey: "gitexclude",
  },
  {
    flag: "lfs",
    label: "Enable Git LFS",
    description: "Run git lfs install and write the LFS .gitattributes block.",
    templateKey: "gitattributesLfs",
  },
];

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; list: SubmoduleIgnoreList }
  | { kind: "error"; message: string };

export function GitView(props: GitViewProps): React.JSX.Element {
  const { onRun, onEditTemplate } = props;
  const [target, setTarget] = useState("");

  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // Mutable copy of the loaded rows so a toggle can update one in place.
  const [rows, setRows] = useState<SubmoduleIgnoreRow[]>([]);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});

  // Guards a stale `ignore-dirty:list` response from a superseded target.
  const activeTargetRef = useRef(target);
  activeTargetRef.current = target;

  useEffect(() => {
    if (!target) {
      setState({ kind: "idle" });
      setRows([]);
      setPending({});
      setRowError({});
      return;
    }

    let cancelled = false;
    const requested = target;
    setState({ kind: "loading" });
    setRows([]);
    setPending({});
    setRowError({});

    void invokeForResult("ignore-dirty:list", { target: requested })
      .then((raw) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        const list = raw as SubmoduleIgnoreList;
        setState({ kind: "loaded", list });
        if (list.status === "ok") setRows(list.submodules);
      })
      .catch((err: unknown) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  const onToggle = (row: SubmoduleIgnoreRow, next: boolean): void => {
    setPending((p) => ({ ...p, [row.name]: true }));
    setRowError((e) => {
      const { [row.name]: _removed, ...rest } = e;
      return rest;
    });
    // Optimistic flip; reverted on failure.
    setRows((rs) => rs.map((r) => (r.name === row.name ? { ...r, localDirty: next } : r)));

    void invokeForResult("ignore-dirty:set", { target, name: row.name, ignored: next })
      .catch((err: unknown) => {
        setRows((rs) => rs.map((r) => (r.name === row.name ? { ...r, localDirty: !next } : r)));
        setRowError((e) => ({ ...e, [row.name]: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        setPending((p) => {
          const { [row.name]: _removed, ...rest } = p;
          return rest;
        });
      });
  };

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Git setup</CardTitle>
          <CardDescription>
            Install .gitignore, .git/info/exclude, and/or Git LFS, and toggle{" "}
            <code>ignore=dirty</code> per submodule in a project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectControl id="git-target" label="Target project" value={target} onChange={setTarget} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {GIT_OPS.map((op) => (
          <div
            key={op.flag}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{op.label}</p>
              <p className="text-xs text-muted-foreground">{op.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Edit ${op.label} template`}
                onClick={() => onEditTemplate(op.templateKey)}
              >
                <Pencil />
              </Button>
              <Button type="button" onClick={() => onRun("git", { [op.flag]: true, target })}>
                Run
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 className="text-sm font-medium">Ignore dirty submodules</h2>
          <p className="text-xs text-muted-foreground">
            Toggle <code>ignore=dirty</code> per submodule so its uncommitted changes stop
            polluting <code>git status</code>. Writes the repo&apos;s local git config only.
          </p>
        </div>

        {state.kind === "idle" ? (
          <p className="px-1 text-sm text-muted-foreground">
            Select a project to load its submodules.
          </p>
        ) : state.kind === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-10">
            <LoaderCircle className="size-4 animate-spin" />
            <p className="text-sm text-muted-foreground" role="status">
              Loading submodules…
            </p>
          </div>
        ) : state.kind === "error" ? (
          <p className="px-1 text-sm text-destructive" role="alert">
            {state.message}
          </p>
        ) : state.list.status === "notRepo" ? (
          <p className="px-1 text-sm text-destructive" role="alert">
            Not a git repository: {state.list.target}
          </p>
        ) : state.list.status === "noSubmodules" ? (
          <p className="px-1 text-sm text-muted-foreground">
            This repository has no submodules.
          </p>
        ) : (
          <div className="space-y-2" role="group" aria-label="Submodules">
            {rows.map((row) => {
              const toggleId = `ignore-dirty-${row.name}`;
              const gitmodulesHint = row.gitmodulesIgnore === "dirty" || row.gitmodulesIgnore === "all";
              return (
                <div
                  key={row.name}
                  className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <label htmlFor={toggleId} className="cursor-pointer text-sm font-medium">
                      {row.path}
                    </label>
                    {row.name !== row.path ? (
                      <p className="truncate text-xs text-muted-foreground">name: {row.name}</p>
                    ) : null}
                    {gitmodulesHint ? (
                      <Badge variant="muted" className="mt-1.5">
                        also ignored via .gitmodules
                      </Badge>
                    ) : null}
                    {rowError[row.name] ? (
                      <p className="mt-1 text-xs text-destructive" role="alert">
                        {rowError[row.name]}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    id={toggleId}
                    checked={row.localDirty}
                    disabled={pending[row.name] === true}
                    onCheckedChange={(next) => onToggle(row, next)}
                    aria-label={`ignore=dirty for ${row.path}`}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
