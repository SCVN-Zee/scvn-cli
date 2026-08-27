/**
 * desktop/renderer/views/mcp-view.tsx — The MCP page.
 *
 * Project-first, status-aware, AND update-aware. Pick a Unity project; the page
 * detects its install state offline (`mcp:project-status`) and then layers an
 * explicit online check (`mcp:check-updates`) on top:
 *  - not installed → Install, with an add-on picker and a core-version chooser;
 *  - installed vX  → an EDITABLE add-on picker (seeded from the marker set) and
 *    a version chooser, both routed to `scvn mcp reconfigure`, plus Uninstall.
 * With no project picked the page still checks the registry and shows the
 * available core + add-on catalog on entry.
 *
 * The version chooser defaults to the registry's newest published core and lists
 * every published version; picking one the selected add-ons don't support routes
 * the action with `force` and a runtime-skew warning. The online check is
 * fail-soft: a dead registry disables the chooser (no offline install) rather
 * than blocking. All resolution lives in the host; this view renders payloads and
 * routes actions through `onRun("mcp", …)`, the same `scvn mcp` handler the CLI uses.
 */

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ProjectControl } from "@/views/capability-form";
import { invokeForResult } from "@/lib/bridge";
import type { LaunchValues, McpProjectStatus, CheckUpdatesResult } from "@shared/commands";

export interface McpViewProps {
  onRun: (capabilityId: string, values: LaunchValues) => void;
}

const CORE_PKG = "com.ivanmurzak.unity.mcp";
const ADDON_NAMESPACE = "com.ivanmurzak.unity.mcp.";

/** Short, human name for a package row (core/ppx/addon). */
function pkgLabel(pkg: string): string {
  if (pkg === CORE_PKG) return "core";
  if (pkg.startsWith(ADDON_NAMESPACE)) return pkg.slice(ADDON_NAMESPACE.length);
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

const OFFLINE_RESULT: CheckUpdatesResult = {
  resolved: null,
  conflict: null,
  offline: true,
  current: null,
  updates: [],
  catalog: [],
  coreNewestPublished: null,
  coreVersions: [],
  compatibleCores: [],
};

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; status: McpProjectStatus }
  | { kind: "error"; message: string };

type CheckState =
  | { kind: "idle" }
  | { kind: "checking"; last: CheckUpdatesResult | null }
  | { kind: "done"; result: CheckUpdatesResult };

export function McpView(props: McpViewProps): React.JSX.Element {
  const { onRun } = props;
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });
  // The add-on set the actions operate on. Seeded from the marker set for an
  // installed project (so it is pre-checked and editable) and from the default
  // seed otherwise.
  const [addons, setAddons] = useState<string[]>([]);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  // The core version the action vendors. Empty until the online check seeds it
  // to the newest published core; the chooser then drives install/reconfigure.
  const [version, setVersion] = useState("");

  // Drops a stale `mcp:project-status` response from a superseded target.
  const activeTargetRef = useRef(target);
  activeTargetRef.current = target;
  // Monotonic token so only the newest debounced check-updates response wins.
  const checkTokenRef = useRef(0);

  // 1. Offline status (instant), seeding the picker. Runs for the empty target
  //    too — the host returns the addon catalog + defaults for the entry view.
  useEffect(() => {
    let cancelled = false;
    const requested = target;
    setStatus({ kind: "loading" });
    setCheck({ kind: "idle" });
    setVersion("");

    void invokeForResult("mcp:project-status", { target: requested })
      .then((raw) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        const s = raw as McpProjectStatus;
        setStatus({ kind: "loaded", status: s });
        setAddons(s.installed ? s.installedAddons : s.defaultAddons);
      })
      .catch((err: unknown) => {
        if (cancelled || requested !== activeTargetRef.current) return;
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  // 2. Online, action-equivalent check, debounced and keyed on [target, addons].
  //    Toggling an add-on re-resolves so the shown versions and the Install/Apply
  //    target always match what the action would actually vendor.
  useEffect(() => {
    if (status.kind !== "loaded") return;
    const token = ++checkTokenRef.current;
    // Keep the last resolved result mounted during the re-check so the chooser
    // does not flicker on every toggle; actions stay disabled until it settles.
    setCheck((prev) => ({
      kind: "checking",
      last: prev.kind === "done" ? prev.result : prev.kind === "checking" ? prev.last : null,
    }));

    const handle = setTimeout(() => {
      void invokeForResult("mcp:check-updates", { addons, target: target || undefined })
        .then((raw) => {
          if (token !== checkTokenRef.current) return;
          setCheck({ kind: "done", result: raw as CheckUpdatesResult });
        })
        .catch(() => {
          if (token !== checkTokenRef.current) return;
          setCheck({ kind: "done", result: OFFLINE_RESULT });
        });
    }, 250);

    return () => clearTimeout(handle);
  }, [target, addons, status.kind]);

  // Seed the chooser from the newest published core once the check resolves;
  // keep the user's pick when it is still a published option.
  useEffect(() => {
    if (check.kind !== "done") return;
    const options = check.result.coreVersions;
    const latest = options[0];
    if (latest === undefined) return;
    setVersion((prev) => (prev && options.includes(prev) ? prev : latest));
  }, [check]);

  const toggleAddon = (value: string, checked: boolean): void => {
    setAddons((prev) => (checked ? [...prev, value] : prev.filter((v) => v !== value)));
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>MCP</CardTitle>
          <CardDescription>
            Vendor the Unity MCP integration into a project. Pick a project to see its
            current state, available updates, and the actions available for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectControl id="mcp-target" label="Target project" value={target} onChange={setTarget} />
        </CardContent>
      </Card>

      {status.kind === "loading" ? (
        <div className="flex items-center justify-center gap-2 py-10">
          <LoaderCircle className="size-4 animate-spin" />
          <p className="text-sm text-muted-foreground" role="status">
            Detecting MCP status…
          </p>
        </div>
      ) : status.kind === "error" ? (
        <p className="px-1 text-sm text-destructive" role="alert">
          {status.message}
        </p>
      ) : target === "" ? (
        <CatalogCard check={check} />
      ) : (
        <ProjectCard
          status={status.status}
          addons={addons}
          check={check}
          version={version}
          onVersionChange={setVersion}
          onToggleAddon={toggleAddon}
          onRun={onRun}
          target={target}
        />
      )}
    </div>
  );
}

/** The result to render: the latest resolved payload, held through a re-check so
 *  the cards do not unmount on every toggle. Actions still gate on `checking`. */
function shownResult(check: CheckState): CheckUpdatesResult | null {
  if (check.kind === "done") return check.result;
  if (check.kind === "checking") return check.last;
  return null;
}

/** The on-entry, project-independent view: available core + add-on versions. */
function CatalogCard(props: { check: CheckState }): React.JSX.Element {
  const { check } = props;
  const done = shownResult(check);
  const resolved = done?.resolved ?? null;
  const coreNewest = done?.coreNewestPublished ?? null;
  // `resolved.core` is the coherent install target; it is capped below the core's
  // true latest when the seeded add-ons have not shipped a build for it yet.
  const capped = resolved !== null && coreNewest !== null && coreNewest !== resolved.core;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Available versions</CardTitle>
        <CardDescription>Select a project above to install or update it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <UpdateCheckLine check={check} />
        {resolved ? (
          <div className="space-y-1">
            <p className="text-sm">
              Latest core: <span className="font-medium">v{coreNewest ?? resolved.core}</span>
            </p>
            {capped ? (
              <p className="text-xs text-muted-foreground">
                The default add-ons only support up to v{resolved.core} so far —
                installing now vendors v{resolved.core}.
              </p>
            ) : null}
          </div>
        ) : null}
        {done && done.catalog.length > 0 ? <CatalogList catalog={done.catalog} /> : null}
      </CardContent>
    </Card>
  );
}

function ProjectCard(props: {
  status: McpProjectStatus;
  addons: string[];
  check: CheckState;
  version: string;
  onVersionChange: (value: string) => void;
  onToggleAddon: (value: string, checked: boolean) => void;
  onRun: McpViewProps["onRun"];
  target: string;
}): React.JSX.Element {
  const { status, addons, check, version, onVersionChange, onToggleAddon, onRun, target } = props;

  const result = shownResult(check);
  // A re-check is in flight: keep displaying `result` but block actions so the
  // run's `force` is never computed from a stale (or empty) resolve.
  const checking = check.kind === "checking";
  const conflict = result?.conflict ?? null;
  const offline = result?.offline ?? false;
  const coreVersions = result?.coreVersions ?? [];
  const compatibleCores = result?.compatibleCores ?? [];
  // A published core the selected add-ons don't all pin is the pin-skew that
  // attachMcp refuses without force; the action carries `force` in that case.
  const needsForce = version !== "" && coreVersions.length > 0 && !compatibleCores.includes(version);
  const newestSupported = compatibleCores[0] ?? null;
  // The chooser only exists online — a version must be picked before any action.
  const hasChooser = !offline && coreVersions.length > 0;

  // Set-equality against the marker set: has the user edited the add-on selection?
  const setChanged =
    addons.length !== status.installedAddons.length ||
    !status.installedAddons.every((x) => addons.includes(x));
  const versionChanged = version !== "" && version !== status.version;
  const dirty = setChanged || versionChanged;
  // Newest-published version per add-on (full menu) for the picker rows.
  const addonVersions: Record<string, string | null> = Object.fromEntries(
    (result?.catalog ?? []).map((c) => [c.addon, c.newestPublished]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Status
          {status.installed ? (
            <Badge variant="success">installed v{status.version ?? "?"}</Badge>
          ) : (
            <Badge variant="muted">not installed</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Choose a core version and add-ons, then {status.installed ? "apply the changes" : "install"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <UpdateCheckLine check={check} />

        {conflict ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="note">
            These add-ons share no compatible core:
            <br />
            {conflict}
          </p>
        ) : null}

        {hasChooser ? (
          <div className="space-y-2">
            <Label htmlFor="mcp-version">Core version</Label>
            <Select value={version || undefined} onValueChange={onVersionChange}>
              <SelectTrigger
                id="mcp-version"
                className="w-full"
                aria-label={version ? `Core v${version}` : "Select a version"}
              >
                {version ? (
                  <span className="font-mono">v{version}</span>
                ) : (
                  <span className="text-muted-foreground">Select a version</span>
                )}
              </SelectTrigger>
              <SelectContent>
                {coreVersions.map((v) => (
                  <SelectItem key={v} value={v} textValue={v}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">v{v}</span>
                      {compatibleCores.includes(v) ? null : (
                        <span
                          className="text-xs text-muted-foreground"
                          title="The selected add-ons don't declare support for this core — installing needs a --force override"
                        >
                          · add-ons unsupported
                        </span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsForce ? (
              <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground" role="note">
                {newestSupported
                  ? `The selected add-ons support up to core v${newestSupported}. Installing v${version} forces an unsupported combo — MCP tools may fail at runtime.`
                  : `The selected add-ons share no common core. Installing v${version} forces an unsupported combo — MCP tools may fail at runtime.`}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label>Add-ons</Label>
          <div role="group" aria-label="Add-ons" className="space-y-0.5 rounded-lg border bg-card p-2">
            {status.addonOptions.map((option) => {
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
                    onCheckedChange={(next) => onToggleAddon(option.value, next === true)}
                  />
                  <span className="flex-1">{option.label}</span>
                  {addonVersions[option.value] ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {addonVersions[option.value]}
                    </span>
                  ) : null}
                </Label>
              );
            })}
          </div>
        </div>

        {status.installed ? (
          <>
            <Button
              type="button"
              disabled={offline || checking || version === "" || !dirty}
              onClick={() =>
                onRun("mcp", { verb: "reconfigure", target, addons, version, force: needsForce })
              }
            >
              {!dirty
                ? "Up to date"
                : versionChanged && !setChanged
                  ? `Update to v${version}`
                  : `Apply changes (v${version})`}
            </Button>
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
          <Button
            type="button"
            disabled={offline || checking || version === ""}
            onClick={() =>
              onRun("mcp", { verb: "install", target, addons, version, force: needsForce })
            }
          >
            {version ? `Install v${version}` : "Install"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** The "checking / offline" status line for the online update check. */
function UpdateCheckLine(props: { check: CheckState }): React.JSX.Element | null {
  const { check } = props;
  if (check.kind === "checking") {
    return (
      <div className="flex items-center gap-2">
        <LoaderCircle className="size-3.5 animate-spin" />
        <p className="text-xs text-muted-foreground" role="status">
          Checking for updates…
        </p>
      </div>
    );
  }
  if (check.kind === "done" && check.result.offline) {
    return (
      <p className="text-xs text-muted-foreground">Registry unreachable — offline.</p>
    );
  }
  return null;
}

/** Informational newest-published-per-addon list. NOT the authoritative solve. */
function CatalogList(props: {
  catalog: CheckUpdatesResult["catalog"];
}): React.JSX.Element {
  return (
    <div className="space-y-0.5 rounded-lg border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Add-ons (newest published; may pin a different core)
      </p>
      {props.catalog.map((c) => (
        <p key={c.addon} className="font-mono text-xs text-muted-foreground">
          {pkgLabel(c.addon)}: {c.newestPublished ?? "—"}
        </p>
      ))}
    </div>
  );
}
