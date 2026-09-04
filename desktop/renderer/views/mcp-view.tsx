import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ProjectControl } from "@/views/capability-form";
import { invokeForResult } from "@/lib/bridge";
import type { LaunchValues, McpProjectStatus } from "@shared/commands";

export interface McpViewProps {
  onRun: (capabilityId: string, values: LaunchValues) => void;
}

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; status: McpProjectStatus }
  | { kind: "error"; message: string };

/** Last used target project, restored across view remounts and app restarts. */
const TARGET_KEY = "scvn.mcp.target";

function persistedTarget(): string {
  try {
    return localStorage.getItem(TARGET_KEY) ?? "";
  } catch {
    return "";
  }
}

export function McpView({ onRun }: McpViewProps): React.JSX.Element {
  const [target, setTargetState] = useState(persistedTarget);
  const setTarget = (value: string): void => {
    setTargetState(value);
    try {
      localStorage.setItem(TARGET_KEY, value);
    } catch {
      /* storage unavailable — in-memory only */
    }
  };
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });
  const [extensions, setExtensions] = useState<string[]>([]);
  const [agent, setAgent] = useState("claude-code");
  const [enableAllTools, setEnableAllTools] = useState(true);
  const [enableAllPrompts, setEnableAllPrompts] = useState(true);
  const [enableAllResources, setEnableAllResources] = useState(true);
  const activeTarget = useRef("");

  useEffect(() => {
    activeTarget.current = target;
    let cancelled = false;
    setStatus({ kind: "loading" });
    void invokeForResult("mcp:project-status", { target })
      .then((raw) => {
        if (cancelled || activeTarget.current !== target) return;
        const next = raw as McpProjectStatus;
        setStatus({ kind: "loaded", status: next });
        setExtensions(next.installed ? next.installedAddons : next.defaultExtensions);
        const nextAgent = next.agent ?? next.agentOptions[0]?.value ?? "claude-code";
        setAgent(nextAgent);
        setEnableAllTools(next.enableAllTools);
        setEnableAllPrompts(next.enableAllPrompts);
        setEnableAllResources(next.enableAllResources);
      })
      .catch((error: unknown) => {
        if (!cancelled && activeTarget.current === target) {
          setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  const toggleExtension = (value: string, checked: boolean): void => {
    setExtensions((current) => checked ? [...new Set([...current, value])] : current.filter((item) => item !== value));
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>MCP</CardTitle>
          <CardDescription>Install or update Unity-MCP packages and configure a project-local AI agent.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectControl id="mcp-target" label="Target project" value={target} onChange={setTarget} />
        </CardContent>
      </Card>

      {status.kind === "loading" ? <p className="py-8 text-center text-sm text-muted-foreground" role="status">Detecting MCP status…</p> : null}
      {status.kind === "error" ? <p className="px-1 text-sm text-destructive" role="alert">{status.message}</p> : null}
      {status.kind === "loaded" ? (
        <ProjectCard
          target={target}
          status={status.status}
          extensions={extensions}
          agent={agent}
          enableAllTools={enableAllTools}
          enableAllPrompts={enableAllPrompts}
          enableAllResources={enableAllResources}
          onToggleExtension={toggleExtension}
          onAgentChange={setAgent}
          onEnableAllToolsChange={setEnableAllTools}
          onEnableAllPromptsChange={setEnableAllPrompts}
          onEnableAllResourcesChange={setEnableAllResources}
          onRun={onRun}
        />
      ) : null}
    </div>
  );
}

function ProjectCard(props: {
  target: string;
  status: McpProjectStatus;
  extensions: string[];
  agent: string;
  enableAllTools: boolean;
  enableAllPrompts: boolean;
  enableAllResources: boolean;
  onToggleExtension: (value: string, checked: boolean) => void;
  onAgentChange: (value: string) => void;
  onEnableAllToolsChange: (value: boolean) => void;
  onEnableAllPromptsChange: (value: boolean) => void;
  onEnableAllResourcesChange: (value: boolean) => void;
  onRun: McpViewProps["onRun"];
}): React.JSX.Element {
  const { target, status, extensions, agent, enableAllTools, enableAllPrompts, enableAllResources,
    onToggleExtension, onAgentChange, onEnableAllToolsChange, onEnableAllPromptsChange,
    onEnableAllResourcesChange, onRun } = props;
  const disabled = target === "";
  const changed = !status.installed || agent !== (status.agent ?? "claude-code") ||
    enableAllTools !== status.enableAllTools || enableAllPrompts !== status.enableAllPrompts ||
    enableAllResources !== status.enableAllResources || extensions.length !== status.installedAddons.length ||
    status.installedAddons.some((item) => !extensions.includes(item));
  const capabilityOptions = [
    ["tools", "Tools", enableAllTools, onEnableAllToolsChange],
    ["prompts", "Prompts", enableAllPrompts, onEnableAllPromptsChange],
    ["resources", "Resources", enableAllResources, onEnableAllResourcesChange],
  ] as const;
  const values = {
    target,
    extensions,
    agent,
    enableAllTools,
    enableAllPrompts,
    enableAllResources,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Status
          {status.installed ? <Badge variant="success">installed v{status.version ?? "?"}</Badge> : <Badge variant="muted">not installed</Badge>}
        </CardTitle>
        <CardDescription>Choose the project-local agent and Unity-MCP extensions to generate.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="mcp-agent">Target agent</Label>
          <Select value={agent} onValueChange={onAgentChange}>
            <SelectTrigger id="mcp-agent" aria-label="Target agent">
              {status.agentOptions.find((option) => option.value === agent)?.label ?? agent}
            </SelectTrigger>
            <SelectContent>
              {status.agentOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Unity-MCP extensions</Label>
          <div role="group" aria-label="Unity-MCP extensions" className="space-y-0.5 rounded-lg border bg-card p-2">
            {status.extensionOptions.map((option) => (
              <Label key={option.value} htmlFor={`mcp-extension-${option.value}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-accent">
                <Checkbox id={`mcp-extension-${option.value}`} checked={extensions.includes(option.value)} onCheckedChange={(next) => onToggleExtension(option.value, next === true)} />
                <span>{option.label}</span>
              </Label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Generated MCP capabilities</Label>
          <div role="group" aria-label="Generated MCP capabilities" className="space-y-0.5 rounded-lg border bg-card p-2">
            {capabilityOptions.map(([id, label, checked, onChange]) => (
              <Label key={id} htmlFor={`mcp-${id}`} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-accent">
                <Checkbox id={`mcp-${id}`} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
                <span>{label}</span>
              </Label>
            ))}
          </div>
        </div>

        {status.installed ? (
          <div className="flex gap-2">
            <Button type="button" disabled={disabled} onClick={() => onRun("mcp", { verb: "finish", ...values })}>Open Unity &amp; finish setup</Button>
            <Button type="button" disabled={disabled} onClick={() => onRun("mcp", { verb: "skills", target, agent })}>Generate skills</Button>
            <Button type="button" disabled={disabled || !changed} onClick={() => onRun("mcp", { verb: "reconfigure", ...values })}>Apply changes</Button>
            <Button type="button" variant="destructive" onClick={() => onRun("mcp", { verb: "uninstall", target })}>Uninstall</Button>
          </div>
        ) : (
          <Button type="button" disabled={disabled} onClick={() => onRun("mcp", { verb: "install", ...values })}>Install</Button>
        )}
      </CardContent>
    </Card>
  );
}
