/**
 * desktop/renderer/views/template-editor.tsx — Focused single-template editor.
 *
 * Opened from the Git setup form for ONE artifact. Shows the selected preset's
 * content in a monospace textarea with an override/default badge, plus:
 *   - preset selector (global: used by CLI and GUI)
 *   - Save (writes the selected preset's content)
 *   - Create preset from the current editor buffer
 *   - Delete preset (Default is undeletable) with in-page confirmation
 * Unsaved changes are guarded on preset switch and Back.
 */

import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { invokeForResult } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import type { EditableTemplateKey, TemplateContent } from "@shared/commands";

export interface TemplateEditorViewProps {
  templateKey: EditableTemplateKey;
  label: string;
  onBack: () => void;
}

type StatusKind = "info" | "error" | "success" | "warning";

const STATUS_CLASS: Record<StatusKind, string> = {
  info: "text-muted-foreground",
  error: "text-destructive",
  success: "text-success",
  warning: "text-warning",
};

const DEFAULT_PRESET_ID = "default";
const ADD_PRESET_ACTION = "add-preset";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function TemplateEditorView(props: TemplateEditorViewProps): React.JSX.Element {
  const { templateKey, label, onBack } = props;

  const [loaded, setLoaded] = useState<TemplateContent | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({
    text: "Loading…",
    kind: "info",
  });
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const presetTriggerRef = useRef<HTMLButtonElement>(null);

  async function refresh(notify?: { text: string; kind: StatusKind }): Promise<void> {
    const next = (await invokeForResult("templates:read", { key: templateKey })) as TemplateContent;
    setLoaded(next);
    setValue(next.content);
    setStatus(notify ?? { text: `Editing preset “${presetName(next)}”.`, kind: "info" });
  }

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setValue("");
    setBusy(false);
    setNewName("");
    setConfirmingDelete(false);
    setCreating(false);
    setStatus({ text: "Loading…", kind: "info" });

    void invokeForResult("templates:read", { key: templateKey })
      .then((result) => {
        if (cancelled) return;
        const next = result as TemplateContent;
        setLoaded(next);
        setValue(next.content);
        setStatus({
          text: next.isOverridden
            ? `Editing preset “${presetName(next)}” (your override).`
            : `Showing bundled content for preset “${presetName(next)}”.`,
          kind: "info",
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({
          text: `Failed to load: ${errorMessage(err)}`,
          kind: "error",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [templateKey]);

  async function run(label: string, op: () => Promise<void>): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await op();
    } catch (err: unknown) {
      // Draft (value) untouched — user can retry or copy it out.
      setStatus({ text: `${label} failed: ${errorMessage(err)}`, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function handleSave(): void {
    if (!loaded || loaded.selectedPreset === DEFAULT_PRESET_ID) return;
    void run("Save", async () => {
      await invokeForResult("templates:write", { key: templateKey, preset: loaded.selectedPreset, content: value });
      await refresh({
        text: "Saved. This preset is now used by the CLI and GUI.",
        kind: "success",
      });
    });
  }

  function handleDiscard(): void {
    if (!loaded) return;
    setValue(loaded.content);
    setConfirmingDelete(false);
  }

  function handleSelectPreset(preset: string): void {
    if (!loaded) return;
    if (preset === ADD_PRESET_ACTION) {
      setCreating(true);
      setConfirmingDelete(false);
      return;
    }
    if (preset === loaded.selectedPreset) return;
    if (dirty) {
      setStatus({ text: "Unsaved changes — save or discard before switching presets.", kind: "warning" });
      return;
    }
    void run("Preset switch", async () => {
      await invokeForResult("templates:select", { key: templateKey, preset });
      setConfirmingDelete(false);
      await refresh({ text: `Switched to preset “${presetName(loaded, preset)}”.`, kind: "info" });
      closeCreation();
    });
  }

  function closeCreation(): void {
    setCreating(false);
    setNewName("");
    presetTriggerRef.current?.focus();
  }

  function handleCreate(): void {
    const name = newName.trim();
    if (!loaded || !name) return;
    void run("Create preset", async () => {
      await invokeForResult("templates:create", { key: templateKey, name, content: value });
      await refresh({ text: `Preset “${name}” created from the editor and selected.`, kind: "success" });
      closeCreation();
    });
  }

  function handleDelete(): void {
    if (!loaded) return;
    void run("Delete preset", async () => {
      const gone = presetName(loaded);
      await invokeForResult("templates:delete", { key: templateKey, preset: loaded.selectedPreset });
      setConfirmingDelete(false);
      await refresh({ text: `Preset “${gone}” deleted — back on Default.`, kind: "success" });
    });
  }

  function handleBack(): void {
    if (dirty) {
      setStatus({ text: "Unsaved changes — save or discard before going back.", kind: "warning" });
      return;
    }
    onBack();
  }

  const overridden = loaded?.isOverridden === true;
  const dirty = loaded != null && value !== loaded.content;
  const isDefault = loaded?.selectedPreset === DEFAULT_PRESET_ID;

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col p-6">
      <Card className="flex min-h-0 flex-1 flex-col gap-4">
        <CardHeader className="gap-3">
          <div>
            <Button type="button" variant="ghost" size="sm" className="-ml-2" disabled={busy} onClick={handleBack}>
              <ArrowLeft />
              Back
            </Button>
          </div>
          <div className="flex items-center gap-2.5">
            <CardTitle className="font-mono text-base">{label}</CardTitle>
            <Badge variant={overridden ? "success" : "muted"}>
              {overridden ? "custom content" : "bundled content"}
            </Badge>
            {dirty ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                <span className="size-1.5 rounded-full bg-warning" />
                Unsaved
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          {loaded ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex items-center gap-2">
                <Select
                  value={loaded.selectedPreset}
                  onValueChange={(preset) => handleSelectPreset(preset)}
                  disabled={busy}
                >
                  <SelectTrigger ref={presetTriggerRef} size="sm" className="w-52" aria-label="Template preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent onCloseAutoFocus={(event) => {
                    if (nameInputRef.current) { event.preventDefault(); nameInputRef.current.focus(); }
                  }}>
                    {loaded.presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={ADD_PRESET_ACTION} className="mt-1 rounded-t-none border-t pt-2.5">
                      <span className="flex items-center gap-2"><Plus className="size-4" />Add new preset…</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isDefault || busy || creating}
                  onClick={() => setConfirmingDelete((v) => !v)}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
              <p className="text-xs text-muted-foreground sm:ml-auto sm:text-right">
                The selected preset is global — the CLI and this app both use it.
              </p>
            </div>
          ) : null}
          {loaded && creating ? (
            <form
              aria-label="Create preset"
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
              onSubmit={(event) => { event.preventDefault(); handleCreate(); }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); closeCreation(); }
              }}
            >
              <Input
                ref={nameInputRef}
                autoFocus
                className="sm:max-w-56"
                placeholder="New preset name"
                aria-label="New preset name"
                maxLength={80}
                value={newName}
                disabled={busy}
                onChange={(event) => setNewName(event.target.value)}
              />
              <Button type="submit" disabled={busy || !newName.trim()}>
                {busy ? "Creating…" : "Create"}
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={closeCreation}>
                Cancel
              </Button>
            </form>
          ) : null}

          {loaded && confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <span className="text-destructive">
                Delete preset “{presetName(loaded)}”? This cannot be undone.
              </span>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={handleDelete}>
                  {busy ? "Deleting…" : "Delete preset"}
                </Button>
              </div>
            </div>
          ) : null}
          {loaded && confirmingDelete && dirty ? (
            <p className="text-xs text-warning">
              You have unsaved edits — they are not part of the preset and will be discarded from the editor.
            </p>
          ) : null}
          <Textarea
            className="min-h-[360px] flex-1 resize-none rounded-lg bg-background/60 px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none inset-shadow-sm"
            style={{ tabSize: 2 }}
            spellCheck={false}
            aria-label={`${label} template content`}
            disabled={!loaded || busy}
            readOnly={isDefault}
            aria-describedby={isDefault ? "default-preset-note" : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {isDefault ? (
            <p id="default-preset-note" className="text-sm text-muted-foreground">
              Default is bundled and read-only. Choose Add new preset… in the dropdown to make changes.
            </p>
          ) : null}
          <div className="-mx-6 flex flex-col gap-3 border-t border-border px-6 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p
              role="status"
              className={cn("text-sm transition-colors duration-150", STATUS_CLASS[status.kind])}
            >
              {status.text}
            </p>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {dirty ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={handleDiscard}>
                  Discard changes
                </Button>
              ) : null}
              <Button type="button" disabled={!loaded || isDefault || !dirty || busy} onClick={handleSave}>
                <Save />
                {busy ? "Working…" : "Save"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function presetName(content: TemplateContent | null, id?: string): string {
  if (content) {
    const found = content.presets.find((p) => p.id === (id ?? content.selectedPreset));
    if (found) return found.name;
  }
  return id ?? content?.selectedPreset ?? DEFAULT_PRESET_ID;
}
