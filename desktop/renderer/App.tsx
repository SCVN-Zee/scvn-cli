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

import { CAPABILITIES, ALL_CAPABILITIES, type LaunchValues, type EditableTemplateKey } from "@shared/commands";
import { AppShell } from "@/components/app-shell";
import { CapabilityForm } from "@/views/capability-form";
import { RunOpView } from "@/views/run-op";
import { GitView } from "@/views/git-view";
import { SettingsView } from "@/views/settings-view";
import { PackagesView } from "@/views/packages-view";
import { McpView } from "@/views/mcp-view";
import { InitView } from "@/views/init-view";
import { OnboardingView } from "@/views/onboarding-view";
import { TemplateEditorView } from "@/views/template-editor";
import { Button } from "@/components/ui/button";
import { invokeForResult } from "@/lib/bridge";
import { LoaderCircle } from "lucide-react";

import type { ConfigStatus } from "@shared/commands";

/** Concise editor titles per editable artifact (Git ops + the Fork merge block). */
const ARTIFACT_LABELS: Record<EditableTemplateKey, string> = {
  gitignore: ".gitignore",
  gitexclude: ".git/info/exclude",
  gitattributesLfs: "Git LFS (.gitattributes)",
  gitattributesMerge: "Unity merge (.gitattributes)",
};

type Route =
  | { kind: "form" }
  | { kind: "run"; command: string; args: unknown; title: string }
  | { kind: "editor"; key: EditableTemplateKey; label: string };

/** First-run gate: probing → onboarding | app. */
type BootPhase = "probing" | "onboarding" | "app";

function readSelftest(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("selftest");
    if (raw === null) return null;
    return raw !== "" && raw !== "1" ? raw : "ping";
  } catch {
    return null;
  }
}

const REVEAL_KEY = "scvn.tabs.revealHidden";

/**
 * Reveal tabs that this build's `SCVN_TABS` hid from the sidebar. ⌘/Ctrl-⇧-.
 * toggles it (macOS Finder's reveal-hidden gesture); the choice persists to
 * localStorage. `event.code === "Period"` is layout-robust — Shift+Period emits
 * ">" as `event.key` on many layouts. A no-op when the build ships every tab.
 */
function useRevealHidden(shortcutsEnabled = true): boolean {
  const [revealed, setRevealed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(REVEAL_KEY) === "1";
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Period") {
        event.preventDefault();
        setRevealed((prev) => {
          const next = !prev;
          try {
            localStorage.setItem(REVEAL_KEY, next ? "1" : "0");
          } catch {
            /* storage unavailable — in-memory only */
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsEnabled]);

  return revealed;
}

export function App() {
  const selftest = React.useMemo(readSelftest, []);
  const [selectedId, setSelectedId] = React.useState<string>(() => CAPABILITIES[0]?.id ?? "");
  const [route, setRoute] = React.useState<Route>(() =>
    selftest ? { kind: "run", command: selftest, args: undefined, title: selftest } : { kind: "form" },
  );

  // Boot gate. The probe runs before the shell mounts so the main app never
  // flashes before onboarding; ?selftest boots straight into its run and never
  // gates. needsSetup drives the session banner after Skip/Finish.
  const [phase, setPhase] = React.useState<BootPhase>(() => (selftest ? "app" : "probing"));
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [initDirty, setInitDirty] = React.useState(false);

  React.useEffect(() => {
    if (selftest) return;
    let cancelled = false;
    void invokeForResult("config:status")
      .then((raw) => {
        if (cancelled) return;
        const ready = (raw as ConfigStatus).ready;
        setNeedsSetup(!ready);
        setPhase(ready ? "app" : "onboarding");
      })
      .catch(() => {
        // A failed probe must not lock the user out of the app.
        if (!cancelled) setPhase("app");
      });
    return () => {
      cancelled = true;
    };
  }, [selftest]);
  const setupStatusSeq = React.useRef(0);
  const finishOnboarding = React.useCallback(() => {
    const seq = ++setupStatusSeq.current;
    setPhase("app");
    // Refresh banner truth: finishing under an invalid env override stays
    // not-ready (the onboarding notice already explained why).
    void invokeForResult("config:status")
      .then((raw) => {
        if (setupStatusSeq.current === seq) setNeedsSetup(!(raw as ConfigStatus).ready);
      })
      .catch(() => undefined);
  }, []);
  const skipOnboarding = React.useCallback(() => {
    setupStatusSeq.current += 1;
    setPhase("app");
  }, []);
  const reopenOnboarding = React.useCallback(() => {
    setupStatusSeq.current += 1;
    setPhase("onboarding");
  }, []);

  const revealed = useRevealHidden(phase !== "onboarding");
  const items = React.useMemo(
    () => (revealed ? ALL_CAPABILITIES : CAPABILITIES),
    [revealed],
  );

  // A re-hide (⌘⇧.) can drop the selected tab from the sidebar; fall back to
  // the first visible tab so the content pane never strands on a hidden one.
  React.useEffect(() => {
    if (!items.some((c) => c.id === selectedId)) setSelectedId(items[0]?.id ?? "");
  }, [items, selectedId]);

  const selected = React.useMemo(
    () => items.find((c) => c.id === selectedId) ?? null,
    [items, selectedId],
  );

  const selectCapability = React.useCallback((id: string) => {
    if (id === selectedId) return;
    if (initDirty && !window.confirm("Discard unsaved initializer changes?")) return;
    setInitDirty(false);
    setSelectedId(id);
    setRoute({ kind: "form" });
  }, [initDirty, selectedId]);

  const onRun = React.useCallback(
    (capabilityId: string, values: LaunchValues) => {
      const spec = items.find((c) => c.id === capabilityId);
      setRoute({
        kind: "run",
        command: capabilityId,
        args: values,
        title: spec?.label ?? capabilityId,
      });
    },
    [items],
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

  if (phase === "probing") {
    return (
      <div className="flex h-screen w-screen flex-col bg-background text-foreground">
        <div className="app-drag h-8 shrink-0" />
        <div className="flex flex-1 items-center justify-center" role="status" aria-label="Starting up">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Setup is a blocking modal over the regular shell. The selected route and
  // banner stay mounted underneath so reopening never loses the user's place.
  return (
    <AppShell
      items={items}
      selectedId={selectedId}
      onSelect={selectCapability}
      title={title}
      banner={
        needsSetup && phase === "app" ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-2">
            <p className="text-xs text-muted-foreground">
              The Unity projects root isn&apos;t set up yet — project pickers need it.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={reopenOnboarding}>
              Finish setup
            </Button>
          </div>
        ) : null
      }
      onReplaySetup={reopenOnboarding}
      setupOpen={phase === "onboarding"}
      setup={<OnboardingView onDone={finishOnboarding} onSkip={skipOnboarding} />}
    >
      {route.kind === "run" ? (
        <RunOpView
          key={route.command + JSON.stringify(route.args)}
          command={route.command}
          args={route.args}
          title={route.title}
          onBack={backToForm}
          onRun={onRun}
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
        ) : selected.page === "init" ? (
          <InitView key={selected.id} onDirtyChange={setInitDirty} />
        ) : (
          <CapabilityForm key={selected.id} spec={selected} onRun={onRun} onEditTemplate={onEditTemplate} />
        )
      ) : (
        <p className="p-6 text-sm text-muted-foreground">No tools registered.</p>
      )}
    </AppShell>
  );
}
