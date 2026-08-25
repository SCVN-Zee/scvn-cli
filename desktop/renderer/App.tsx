/**
 * App.tsx — Renderer controller: sidebar selection + view routing.
 *
 * Three routes share the content pane:
 *  - form:   the selected capability's launch form (CapabilityForm)
 *  - run:    an in-flight invocation streaming output/prompts (RunOpView)
 *  - editor: the focused git-artifact template editor (TemplateEditorView)
 *
 * A `?selftest=<cmd>` query (set by the packaged smoke test) boots straight
 * into a run of that command (default `ping`).
 */

import * as React from "react";

import { CAPABILITIES, type LaunchValues, type EditableTemplateKey } from "@shared/commands";
import { AppShell } from "@/components/app-shell";
import { CapabilityForm } from "@/views/capability-form";
import { RunOpView } from "@/views/run-op";
import { GitView } from "@/views/git-view";
import { SettingsView } from "@/views/settings-view";
import { PackagesView } from "@/views/packages-view";
import { McpView } from "@/views/mcp-view";
import { TemplateEditorView } from "@/views/template-editor";

/** Concise editor titles per editable artifact (owned by the Git feature). */
const ARTIFACT_LABELS: Record<EditableTemplateKey, string> = {
  gitignore: ".gitignore",
  gitexclude: ".git/info/exclude",
  gitattributesLfs: "Git LFS (.gitattributes)",
};

type Route =
  | { kind: "form" }
  | { kind: "run"; command: string; args: unknown; title: string }
  | { kind: "editor"; key: EditableTemplateKey; label: string };

function readSelftest(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("selftest");
    if (raw === null) return null;
    return raw !== "" && raw !== "1" ? raw : "ping";
  } catch {
    return null;
  }
}

export function App() {
  const selftest = React.useMemo(readSelftest, []);
  const [selectedId, setSelectedId] = React.useState<string>(() => CAPABILITIES[0]?.id ?? "");
  const [route, setRoute] = React.useState<Route>(() =>
    selftest ? { kind: "run", command: selftest, args: undefined, title: selftest } : { kind: "form" },
  );

  const selected = React.useMemo(
    () => CAPABILITIES.find((c) => c.id === selectedId) ?? null,
    [selectedId],
  );

  const selectCapability = React.useCallback((id: string) => {
    setSelectedId(id);
    setRoute({ kind: "form" });
  }, []);

  const onRun = React.useCallback(
    (capabilityId: string, values: LaunchValues) => {
      const spec = CAPABILITIES.find((c) => c.id === capabilityId);
      setRoute({
        kind: "run",
        command: capabilityId,
        args: values,
        title: spec?.label ?? capabilityId,
      });
    },
    [],
  );

  const onEditTemplate = React.useCallback((key: EditableTemplateKey) => {
    setRoute({ kind: "editor", key, label: ARTIFACT_LABELS[key] });
  }, []);

  const [pkgNonce, setPkgNonce] = React.useState(0);
  const backToForm = React.useCallback(() => {
    setRoute((r) => {
      // Returning from a packages run: bump the nonce so PackagesView remounts
      // and reloads the library (a completed Add/Import changed it).
      if (r.kind === "run" && r.command === "packages") setPkgNonce((n) => n + 1);
      return { kind: "form" };
    });
  }, []);

  const title =
    route.kind === "run"
      ? route.title
      : route.kind === "editor"
        ? `Edit ${route.label}`
        : (selected?.label ?? "Supercent VN Tools");

  return (
    <AppShell items={CAPABILITIES} selectedId={selectedId} onSelect={selectCapability} title={title}>
      {route.kind === "run" ? (
        <RunOpView
          key={route.command + JSON.stringify(route.args)}
          command={route.command}
          args={route.args}
          title={route.title}
          onBack={backToForm}
        />
      ) : route.kind === "editor" ? (
        <TemplateEditorView
          key={route.key}
          templateKey={route.key}
          label={route.label}
          onBack={backToForm}
        />
      ) : selected ? (
        selected.page === "git" ? (
          <GitView key={selected.id} onRun={onRun} onEditTemplate={onEditTemplate} />
        ) : selected.page === "settings" ? (
          <SettingsView key={selected.id} />
        ) : selected.page === "packages" ? (
          <PackagesView key={`${selected.id}:${pkgNonce}`} onRun={onRun} />
        ) : selected.page === "mcp" ? (
          <McpView key={selected.id} onRun={onRun} />
        ) : (
          <CapabilityForm key={selected.id} spec={selected} onRun={onRun} />
        )
      ) : (
        <p className="p-6 text-sm text-muted-foreground">No capabilities registered.</p>
      )}
    </AppShell>
  );
}
