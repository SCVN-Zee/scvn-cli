/**
 * desktop/renderer/views/mcp-view.tsx — The MCP page.
 *
 * Project-first, status-aware. Pick a Unity project; the page then detects that
 * project's MCP install state (`mcp:project-status`, strictly offline) and shows
 * only the actions that make sense for it:
 *  - not installed → Install, with an add-on picker seeded from the defaults;
 *  - installed vX  → Update (to the staged target) and Uninstall.
 * Each action routes to the streaming run view via `onRun("mcp", …)`, driving the
 * same `scvn mcp` handler the CLI uses — no logic duplicated here.
 */

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProjectControl } from "@/views/capability-form";
import { invokeForResult } from "@/lib/bridge";
import type { LaunchValues, McpProjectStatus } from "@shared/commands";

export interface McpViewProps {
  onRun: (capabilityId: string, values: LaunchValues) => void;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; status: McpProjectStatus }
  | { kind: "error"; message: string };

export function McpView(props: McpViewProps): React.JSX.Element {
  const { onRun } = props;
  const [target, setTarget] = useState("");
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // Add-on selection for a fresh install; reseeded from the status payload's
  // defaults on each not-installed (re)load.
  const [addons, setAddons] = useState<string[]>([]);

  // Guards a stale `mcp:project-status` response from a superseded target.
  const activeTargetRef = useRef(target);
  activeTargetRef.current = target;

  useEffect(() => {
    if (!target) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    const requested = target;
    setState({ kind: "loading" });

    void invokeForResult("mcp:project-status", { target: requested })
      .then((raw) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        const status = raw as McpProjectStatus;
        setState({ kind: "loaded", status });
        setAddons(status.installed ? [] : status.defaultAddons);
      })
      .catch((err: unknown) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  const targetVersion = state.kind === "loaded" ? (state.status.staged[0]?.version ?? null) : null;

  const toggleAddon = (value: string, checked: boolean): void => {
    setAddons((prev) => (checked ? [...prev, value] : prev.filter((v) => v !== value)));
  };

  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>MCP</CardTitle>
          <CardDescription>
            Vendor the Unity MCP integration into a project. Pick a project to see its
            current state and the actions available for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectControl id="mcp-target" label="Target project" value={target} onChange={setTarget} />
        </CardContent>
      </Card>

      {state.kind === "idle" ? (
        <p className="px-1 text-sm text-muted-foreground">
          Select a project to detect its MCP status.
        </p>
      ) : state.kind === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <LoaderCircle className="size-4 animate-spin" />
          <p className="text-sm text-muted-foreground" role="status">
            Detecting MCP status…
          </p>
        </div>
      ) : state.kind === "error" ? (
        <p className="px-1 text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Status
              {state.status.installed ? (
                <Badge variant="success">installed v{state.status.version ?? "?"}</Badge>
              ) : (
                <Badge variant="muted">not installed</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {state.status.staged.length === 0
                ? "No versions staged locally — Install will fetch one."
                : `Staged: ${state.status.staged
                    .map((s) => `v${s.version}${s.bundled ? " (bundled)" : ""}`)
                    .join(", ")}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {state.status.installed ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Update</p>
                    <p className="text-xs text-muted-foreground">
                      {targetVersion && targetVersion !== state.status.version
                        ? `Move from v${state.status.version ?? "?"} to v${targetVersion}.`
                        : "Re-vendor the staged source over this project."}
                    </p>
                  </div>
                  <Button type="button" onClick={() => onRun("mcp", { verb: "update", target })}>
                    Update
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Uninstall</p>
                    <p className="text-xs text-muted-foreground">
                      Remove the vendored MCP source from this project.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => onRun("mcp", { verb: "uninstall", target })}
                  >
                    Uninstall
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Add-ons</Label>
                  <div
                    role="group"
                    aria-label="Add-ons"
                    className="space-y-0.5 rounded-lg border bg-card p-2"
                  >
                    {state.status.addonOptions.map((option) => {
                      const optionId = `mcp-addon-${option.value}`;
                      const checked = addons.includes(option.value);
                      return (
                        <Label
                          key={option.value}
                          htmlFor={optionId}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-accent"
                        >
                          <Checkbox
                            id={optionId}
                            checked={checked}
                            onCheckedChange={(next) => toggleAddon(option.value, next === true)}
                          />
                          <span>{option.label}</span>
                        </Label>
                      );
                    })}
                  </div>
                </div>
                <Button type="button" onClick={() => onRun("mcp", { verb: "install", target, addons })}>
                  Install{targetVersion ? ` v${targetVersion}` : ""}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
