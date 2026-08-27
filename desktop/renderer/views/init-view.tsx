import * as React from "react";
import { ChevronRight, Folder, FolderOpen, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { invokeForResult, pickDirectory, pickSaveFile } from "@/lib/bridge";
import {
  buildInitLayoutTree,
  removeInitTreePath,
  renameInitTreePath,
  type InitLayoutTreeNode,
} from "@/lib/init-layout-tree";
import { cn } from "@/lib/utils";
import { ProjectControl } from "@/views/capability-form";
import type { InitLayoutWire, InitResultWire } from "@shared/commands";

const DEFAULT_LAYOUT: InitLayoutWire = {
  directories: [
    "Supercent",
    "Supercent/ProjectName",
    "Supercent/ProjectName/Animation/AnimationClips",
    "Supercent/ProjectName/Animation/AnimatorControllers",
    "Supercent/ProjectName/Audio/SFXs",
    "Supercent/ProjectName/Audio/BGMs",
    "Supercent/ProjectName/Configs",
    "Supercent/ProjectName/Models",
    "Supercent/ProjectName/Fonts",
    "Supercent/ProjectName/Materials",
    "Supercent/ProjectName/Prefabs",
    "Supercent/ProjectName/Scenes",
    "Supercent/ProjectName/Scripts",
    "Supercent/ProjectName/Shaders",
    "Supercent/ProjectName/Sprites",
    "Supercent/ProjectName/Textures",
  ],
};

function cloneLayout(layout: InitLayoutWire): InitLayoutWire {
  return { directories: [...layout.directories] };
}

function DirectoryRow({
  node,
  depth,
  expanded,
  onToggle,
  onRename,
  onRemove,
  onAddChild,
}: {
  node: InitLayoutTreeNode;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onRemove: (path: string) => void;
  onAddChild: (path: string, name: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(node.name);
  const [adding, setAdding] = React.useState(false);
  const [childDraft, setChildDraft] = React.useState("");
  React.useEffect(() => setDraft(node.name), [node.name]);
  const hasChildren = node.children.length > 0;
  const open = hasChildren && expanded.has(node.path);
  const commitRename = (): void => {
    const name = draft.trim();
    if (name && name !== node.name) onRename(node.path, name);
    else setDraft(node.name);
  };
  const commitChild = (): void => {
    const name = childDraft.trim();
    if (!name) return;
    onAddChild(node.path, name);
    setChildDraft("");
    setAdding(false);
  };

  return <li>
    <div className="flex h-9 items-center gap-1.5 rounded-md px-1.5 hover:bg-muted/50" style={{ marginLeft: `${depth * 18}px` }}>
      {hasChildren ? <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`} aria-expanded={open} onClick={() => onToggle(node.path)} className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"><ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} /></button> : <span className="size-5" />}
      {open ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
      <Input aria-label={`Folder ${node.path}`} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commitRename} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 shadow-none hover:border-input focus-visible:border-input" />
      <Button type="button" size="icon" variant="ghost" aria-label={`Add child to ${node.path}`} onClick={() => setAdding((value) => !value)}><Plus className="size-3.5" /></Button>
      <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${node.path}`} onClick={() => onRemove(node.path)}><Trash2 className="size-3.5" /></Button>
    </div>
    {adding ? <div className="flex gap-2 py-1" style={{ marginLeft: `${(depth + 1) * 18 + 30}px` }}><Input autoFocus aria-label={`New child of ${node.path}`} value={childDraft} onChange={(event) => setChildDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") commitChild(); if (event.key === "Escape") setAdding(false); }} placeholder="Child folder" className="h-8" /><Button type="button" size="sm" variant="outline" onClick={commitChild}>Add</Button></div> : null}
    {open ? <ul>{node.children.map((child) => <DirectoryRow key={child.path} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onRename={onRename} onRemove={onRemove} onAddChild={onAddChild} />)}</ul> : null}
  </li>;
}

export function InitView({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }): React.JSX.Element {
  const [targetAssets, setTargetAssets] = React.useState("");
  const [layout, setLayout] = React.useState(() => cloneLayout(DEFAULT_LAYOUT));
  const [addingAtRoot, setAddingAtRoot] = React.useState(false);
  const [rootChildDraft, setRootChildDraft] = React.useState("");
  const [layoutPath, setLayoutPath] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<InitResultWire | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tree = React.useMemo(() => buildInitLayoutTree(layout.directories), [layout.directories]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(["Supercent", "Supercent/ProjectName", "Supercent/ProjectName/Animation", "Supercent/ProjectName/Audio"]));
  const markDirty = (): void => onDirtyChange(true);

  const loadLayout = async (): Promise<void> => {
    const selected = await pickDirectory({ kind: "path", title: "Open layout manifest" });
    if (!selected) return;
    try {
      const next = await invokeForResult("init:load-layout", { path: selected }) as InitLayoutWire;
      setLayout(cloneLayout(next));
      setLayoutPath(selected);
      setExpanded(new Set(buildInitLayoutTree(next.directories).map((node) => node.path)));
      onDirtyChange(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveLayout = async (): Promise<void> => {
    const selected = layoutPath ?? await pickSaveFile({ title: "Save layout manifest", defaultPath: "scvn-layout.json" });
    if (!selected) return;
    try {
      await invokeForResult("init:save-layout", { path: selected, layout });
      setLayoutPath(selected);
      onDirtyChange(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const run = async (dryRun: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setResult(await invokeForResult("init:run", { targetAssets, layout, dryRun }) as InitResultWire);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleExpanded = (path: string): void => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  return <div className="mx-auto w-full max-w-4xl p-6">
    <Card>
      <CardHeader><CardTitle>Initialize project directories</CardTitle><CardDescription>Select a Unity project and fully customize its Assets hierarchy.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <ProjectControl id="init-project" label="Target project" value={targetAssets} onChange={(value) => { markDirty(); setTargetAssets(value); }} />
        <div className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-sm font-medium">Directory hierarchy</h2><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => void loadLayout()}>Load</Button><Button type="button" variant="outline" onClick={() => void saveLayout()}><Save className="mr-1 size-4" />Save</Button></div></div>
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border p-2">
            <div className="flex h-9 items-center gap-2 rounded-md px-2 font-medium"><FolderOpen className="size-4 text-muted-foreground" /><span className="min-w-0 flex-1">Assets</span><Button type="button" size="icon" variant="ghost" aria-label="Add child to Assets" onClick={() => setAddingAtRoot((value) => !value)}><Plus className="size-3.5" /></Button></div>
            {addingAtRoot ? <div className="ml-[48px] flex gap-2 py-1"><Input autoFocus aria-label="New child of Assets" value={rootChildDraft} onChange={(event) => setRootChildDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { const name = rootChildDraft.trim(); if (name && !/[\/\\]/u.test(name)) { markDirty(); setLayout((current) => ({ directories: [...current.directories, name] })); setRootChildDraft(""); setAddingAtRoot(false); } } if (event.key === "Escape") setAddingAtRoot(false); }} placeholder="Child folder" className="h-8" /><Button type="button" size="sm" variant="outline" onClick={() => { const name = rootChildDraft.trim(); if (name && !/[\/\\]/u.test(name)) { markDirty(); setLayout((current) => ({ directories: [...current.directories, name] })); setRootChildDraft(""); setAddingAtRoot(false); } }}>Add</Button></div> : null}
            <ul>{tree.map((node) => <DirectoryRow key={node.path} node={node} depth={1} expanded={expanded} onToggle={toggleExpanded} onRename={(path, name) => { markDirty(); setLayout((current) => ({ directories: renameInitTreePath(current.directories, path, name) })); }} onRemove={(path) => { markDirty(); setLayout((current) => ({ directories: removeInitTreePath(current.directories, path) })); }} onAddChild={(path, name) => { if (/[\/\\]/u.test(name)) return; markDirty(); const childPath = `${path}/${name}`; setLayout((current) => ({ directories: [...current.directories, childPath] })); setExpanded((current) => new Set([...current, path])); }} />)}</ul>
          </div>
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {result ? <p className="text-sm text-muted-foreground" role="status">{result.dryRun ? "Dry run complete" : "Directories ready"}: {result.entries.length} paths</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void run(true)}>Dry run</Button><Button type="button" disabled={busy} onClick={() => void run(false)}>Create</Button></div>
      </CardContent>
    </Card>
  </div>;
}
