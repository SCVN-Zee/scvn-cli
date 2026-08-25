/**
 * desktop/renderer/views/settings-view.tsx — The Settings page.
 *
 * Two sub-tabs merged from the former standalone capabilities:
 *  - Config: edit the Unity projects root (config:prepare to load, config to save).
 *  - Doctor: run environment checks and stream the results inline.
 */

import { useEffect, useRef, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { invokeForResult, pickDirectory } from "@/lib/bridge";
import { logLineClass, useHostRun } from "@/lib/use-host-run";
import { cn } from "@/lib/utils";

export function SettingsView(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[720px] p-6">
      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="doctor">Doctor</TabsTrigger>
        </TabsList>
        <TabsContent value="config">
          <ConfigPanel />
        </TabsContent>
        <TabsContent value="doctor">
          <DoctorPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type StatusKind = "info" | "error" | "success";
const STATUS_CLASS: Record<StatusKind, string> = {
  info: "text-muted-foreground",
  error: "text-destructive",
  success: "text-success",
};

function ConfigPanel(): React.JSX.Element {
  const [projectsRoot, setProjectsRoot] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: StatusKind } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invokeForResult("config:prepare")
      .then((raw) => {
        if (cancelled) return;
        const model = raw as { fields: { name: string; default?: string }[] };
        setProjectsRoot(model.fields.find((f) => f.name === "projectsRoot")?.default ?? "");
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      await invokeForResult("config", { projectsRoot });
      setStatus({ text: "Saved.", kind: "success" });
    } catch (err: unknown) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Config</CardTitle>
        <CardDescription>Set the Unity projects root used by the project pickers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <LoaderCircle className="size-4 animate-spin" />
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="settings-projects-root">Unity projects root</Label>
              <div className="flex gap-2">
                <Input
                  id="settings-projects-root"
                  className="flex-1"
                  value={projectsRoot}
                  placeholder="/path/to/your/Unity/Projects"
                  onChange={(event) => setProjectsRoot(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void pickDirectory({ kind: "dir", title: "Unity projects root" }).then((picked) => {
                      if (picked !== null) setProjectsRoot(picked);
                    });
                  }}
                >
                  <FolderOpen />
                  Browse…
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {status ? <span className={cn("text-sm", STATUS_CLASS[status.kind])}>{status.text}</span> : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DoctorPanel(): React.JSX.Element {
  const { lines, status, start } = useHostRun();
  const logRef = useRef<HTMLPreElement>(null);
  const running = status === "running";

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Doctor</CardTitle>
        <CardDescription>Check git, rsync, Fork, Unity, and other tooling.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Button type="button" disabled={running} onClick={() => start("doctor")}>
            {running ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run environment checks"
            )}
          </Button>
          {status === "done" ? <span className="text-sm text-success">Done</span> : null}
          {status === "failed" ? <span className="text-sm text-destructive">Failed</span> : null}
        </div>
        {lines.length > 0 ? (
          <pre
            ref={logRef}
            className="font-mono text-xs bg-muted/40 rounded-md border p-3 max-h-[60vh] overflow-auto"
            aria-live="polite"
          >
            {lines.map((line, i) => (
              <span key={i} className={cn("block", logLineClass(line.cls))}>
                {line.text}
              </span>
            ))}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            Run the checks to see your environment status.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
