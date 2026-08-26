/**
 * desktop/renderer/views/template-editor.tsx — Focused single-template editor.
 *
 * Opened from the Git setup form for ONE artifact. Shows the effective content
 * in a monospace textarea with an override/default badge, plus Save (writes a
 * user override), Reset (reverts to the bundled default), and Back.
 */

import React, { useEffect, useState } from "react";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setValue("");
    setSaving(false);
    setResetting(false);
    setStatus({ text: "Loading…", kind: "info" });

    void invokeForResult("templates:read", { key: templateKey })
      .then((result) => {
        if (cancelled) return;
        const next = result as TemplateContent;
        setLoaded(next);
        setValue(next.content);
        setStatus({
          text: next.isOverridden ? "Editing your override." : "Showing the bundled default.",
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

  async function handleSave(): Promise<void> {
    if (!loaded) return;
    setSaving(true);
    try {
      await invokeForResult("templates:write", {
        key: templateKey,
        content: value,
      });
      setLoaded((prev) => (prev ? { ...prev, content: value, isOverridden: true } : prev));
      setStatus({
        text: "Saved. This override is now used by the CLI and GUI.",
        kind: "success",
      });
    } catch (err: unknown) {
      setStatus({ text: `Save failed: ${errorMessage(err)}`, kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(): Promise<void> {
    if (!loaded) return;
    setResetting(true);
    try {
      await invokeForResult("templates:reset", { key: templateKey });
      setLoaded((prev) => {
        if (!prev) return prev;
        return { ...prev, content: prev.defaultContent, isOverridden: false };
      });
      setValue(loaded.defaultContent);
      setStatus({
        text: "Override removed — reverted to the bundled default.",
        kind: "success",
      });
    } catch (err: unknown) {
      setStatus({ text: `Reset failed: ${errorMessage(err)}`, kind: "error" });
    } finally {
      setResetting(false);
    }
  }

  const overridden = loaded?.isOverridden === true;
  const dirty = loaded != null && value !== loaded.content;
  const busy = saving || resetting;

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col p-6">
      <Card className="flex min-h-0 flex-1 flex-col gap-4">
        <CardHeader className="gap-3">
          <div>
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
              <ArrowLeft />
              Back
            </Button>
          </div>
          <div className="flex items-center gap-2.5">
            <CardTitle className="font-mono text-base">{label}</CardTitle>
            <Badge variant={overridden ? "success" : "muted"}>
              {overridden ? "override" : "default"}
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
          <Textarea
            className="min-h-[360px] flex-1 resize-none rounded-lg bg-background/60 px-4 py-3 font-mono text-[13px] leading-relaxed shadow-none inset-shadow-sm"
            style={{ tabSize: 2 }}
            spellCheck={false}
            aria-label={`${label} template content`}
            disabled={!loaded}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="-mx-6 flex items-center justify-between gap-4 border-t border-border px-6 pt-4">
            <p
              role="status"
              className={cn("text-sm transition-colors duration-150", STATUS_CLASS[status.kind])}
            >
              {status.text}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!loaded || !loaded.isOverridden || busy}
                onClick={() => void handleReset()}
              >
                <RotateCcw />
                {resetting ? "Resetting…" : "Reset to default"}
              </Button>
              <Button
                type="button"
                disabled={!loaded || !dirty || busy}
                onClick={() => void handleSave()}
              >
                <Save />
                {saving ? "Saving…" : "Save override"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
