/**
 * desktop/renderer/views/onboarding-view.tsx — First-run setup gate.
 *
 * Shown by App when the boot-time config:status probe reports the projects
 * root as not ready (unset, or pointing at a missing directory — the same
 * "usable" predicate as the CLI first-run guard), and replayable any time via
 * the sidebar "?" button. Two steps:
 *  1. set + save the Unity projects root (validated by the shared config
 *     command, then confirmed via projects:discover), surfacing an env
 *     override or stale-path notice instead of a silent retry-loop;
 *  2. the doctor checklist (structured doctor:report) — advisory only,
 *     Finish is always enabled, matching CLI exit-code semantics.
 *
 * Skip hands the user to the app with a session banner; the gate returns on
 * the next launch while the root stays not ready.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckCircle2, CircleX, FolderOpen, LoaderCircle, Minus, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invokeForResult, pickDirectory } from "@/lib/bridge";
import {
  cancelQueuedConfigSave,
  enqueueConfigSave,
  type ConfigSaveOwner,
} from "@/lib/config-save-queue";
import { cn } from "@/lib/utils";

import type { ConfigStatus, DoctorCheckReport, DoctorReport } from "@shared/commands";

export interface OnboardingViewProps {
  /** Finish (step 2) — enter the app. */
  onDone: () => void;
  /** Skip for now — enter the app with the session setup banner. */
  onSkip: () => void;
}

type NoticeKind = "info" | "warning" | "error";

const NOTICE_CLASS: Record<NoticeKind, string> = {
  info: "border-border bg-muted/40 text-muted-foreground",
  warning: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

function Notice({ kind, children }: { kind: NoticeKind; children: React.ReactNode }): React.JSX.Element {
  return (
    <p className={cn("rounded-md border px-3 py-2 text-xs leading-relaxed", NOTICE_CLASS[kind])}>{children}</p>
  );
}

/** Step-1 notices derived from the boot status: env override / stale path. */
function statusNotices(status: ConfigStatus): { kind: NoticeKind; text: string }[] {
  const notices: { kind: NoticeKind; text: string }[] = [];
  if (status.source === "env") {
    const path = status.projectsRoot ?? "";
    notices.push(
      status.ready
        ? {
            kind: "info",
            text: `SCVN_PROJECTS_ROOT is set in this app's environment, so pickers use ${path}. Saving below only changes the file for launches without the override.`,
          }
        : {
            kind: "error",
            text: `SCVN_PROJECTS_ROOT=${path} is set in this app's environment and points to a missing directory. It overrides anything saved here — fix or unset it, then relaunch the app.`,
          },
    );
  } else if (status.projectsRoot !== null && !status.ready) {
    notices.push({
      kind: "warning",
      text: `The saved projects root (${status.projectsRoot}) no longer exists — pick a new folder.`,
    });
  }
  return notices;
}

const SEVERITY_META: Record<DoctorCheckReport["severity"], { icon: React.JSX.Element }> = {
  pass: { icon: <CheckCircle2 className="size-4 shrink-0 text-success" /> },
  warn: { icon: <TriangleAlert className="size-4 shrink-0 text-warning" /> },
  fail: { icon: <CircleX className="size-4 shrink-0 text-destructive" /> },
  skipped: { icon: <Minus className="size-4 shrink-0 text-muted-foreground" /> },
};

function doctorSummary(report: DoctorReport): { text: string; kind: NoticeKind } {
  const fails = report.reports.filter((r) => r.severity === "fail").length;
  const warns = report.reports.filter((r) => r.severity === "warn").length;
  if (fails > 0) return { text: `${fails} check(s) failed — see below. You can still finish; affected tools will tell you when they need something.`, kind: "error" };
  if (warns > 0) return { text: `Essential checks pass · ${warns} warning(s) (optional tooling).`, kind: "warning" };
  return { text: "All checks pass.", kind: "info" };
}

function DoctorRow({ report }: { report: DoctorCheckReport }): React.JSX.Element {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        {SEVERITY_META[report.severity].icon}
        <span className="truncate">{report.label}</span>
      </span>
      {report.detail ? (
        <span className="shrink-0 text-right text-xs text-muted-foreground">{report.detail}</span>
      ) : null}
    </li>
  );
}

export function OnboardingView({ onDone, onSkip }: OnboardingViewProps): React.JSX.Element {
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — projects root
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [projectsRoot, setProjectsRoot] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<{ root: string; count: number } | null>(null);
  const lastSavedRoot = useRef<string | null>(null);
  const hasSuccessfulSave = useRef(false);
  const saveSeq = useRef(0);
  const hasEditedRoot = useRef(false);
  const dirtySinceBaseline = useRef(false);
  const pendingSaves = useRef(0);
  const saveOwner = useRef<ConfigSaveOwner>({});
  const pickerPending = useRef(false);
  const stepTwoBackRef = useRef<HTMLButtonElement>(null);
  const previousStep = useRef<1 | 2>(1);

  // Step 2 — doctor report
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkSeq = useRef(0);

  function updateRoot(value: string): void {
    hasEditedRoot.current = true;
    dirtySinceBaseline.current = true;
    saveSeq.current += 1;
    setProjectsRoot(value);
    setSaved(false);
    setSaveError(null);
    setDiscovered(null);
  }

  useEffect(() => {
    let cancelled = false;
    void invokeForResult("config:status")
      .then((raw) => {
        if (cancelled) return;
        const next = raw as ConfigStatus;

        // A status probe started at mount may resolve after an autosave. Keep
        // an env override visible (it still governs the effective root), but
        // never let a stale file result replace the saved baseline or notices.
        const saveInFlight = pendingSaves.current > 0;
        const canApplyBaseline =
          !hasEditedRoot.current && !saveInFlight && !hasSuccessfulSave.current;
        if (!canApplyBaseline) {
          if (next.source === "env") setStatus(next);
          return;
        }

        setStatus(next);
        const nextRoot = next.projectsRoot ?? "";
        lastSavedRoot.current = nextRoot.trim();
        setProjectsRoot(nextRoot);
      })
      .catch(() => {
        // The boot probe already ran; a repeat failure here just means no
        // prefill — the field stays editable. Do not replace save feedback
        // with a stale probe failure.
        if (!cancelled && !hasEditedRoot.current && pendingSaves.current === 0 && !hasSuccessfulSave.current) {
          setStatus({ projectsRoot: null, ready: false, source: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveRoot(root: string, seq: number): Promise<void> {
    pendingSaves.current += 1;
    try {
      const outcome = await enqueueConfigSave(root, saveOwner.current);
      if (outcome.kind === "superseded" || saveSeq.current !== seq) return;
      const raw = outcome.value as { ok?: boolean; error?: string };
      if (raw?.ok !== true) {
        setSaveError(raw?.error ?? "Could not save the projects root");
        return;
      }
      lastSavedRoot.current = root;
      dirtySinceBaseline.current = false;
      hasSuccessfulSave.current = true;
      setSaved(true);
      setStatus((current) =>
        current?.source === "env"
          ? current
          : { projectsRoot: root, ready: true, source: "file" },
      );

      try {
        const disc = (await invokeForResult("projects:discover")) as {
          root: string;
          projects: unknown[];
        };
        if (saveSeq.current === seq) setDiscovered({ root: disc.root, count: disc.projects.length });
      } catch {
        // The effective root can still be unusable under an env override.
      }
    } catch (err: unknown) {
      if (saveSeq.current === seq) {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      pendingSaves.current -= 1;
      setSaving(pendingSaves.current > 0);
    }
  }

  function commitRoot(value: string): void {
    const root = value.trim();
    if (root === "") {
      saveSeq.current += 1;
      cancelQueuedConfigSave(saveOwner.current);
      setSaved(false);
      setSaveError("Enter a projects root before saving.");
      setSaving(pendingSaves.current > 0);
      return;
    }
    if (!dirtySinceBaseline.current && root === lastSavedRoot.current) {
      if (hasSuccessfulSave.current) setSaved(true);
      return;
    }

    hasEditedRoot.current = true;
    const seq = ++saveSeq.current;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    setDiscovered(null);
    void saveRoot(root, seq);
  }

  async function runChecks(): Promise<void> {
    const seq = ++checkSeq.current;
    setChecking(true);
    setCheckError(null);
    try {
      const raw = await invokeForResult("doctor:report");
      if (checkSeq.current !== seq) return;
      setReport(raw as DoctorReport);
    } catch (err: unknown) {
      if (checkSeq.current !== seq) return;
      setCheckError(err instanceof Error ? err.message : String(err));
    } finally {
      if (checkSeq.current === seq) setChecking(false);
    }
  }

  useEffect(() => {
    if (step === 2) void runChecks();
  }, [step]);

  const notices = status ? statusNotices(status) : [];
  useLayoutEffect(() => {
    if (step === 2) {
      stepTwoBackRef.current?.focus();
    } else if (previousStep.current === 2) {
      document.getElementById("onboarding-projects-root")?.focus();
    }
    previousStep.current = step;
  }, [step]);
  const summary = report ? doctorSummary(report) : null;
  const continueEnabled = saved || (status?.ready ?? false);

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <Card className="onboarding-card">
          <CardHeader>
            <CardTitle id="onboarding-dialog-title">Welcome to Supercent VN Tools</CardTitle>
            <CardDescription id="onboarding-dialog-description">
              {step === 1 ? (
                <>
                  {status?.ready
                    ? "Your projects root is set — adjust it, or continue to the environment checks."
                    : "First, point the app at the folder that holds your Unity projects."}{" "}
                  Changes save automatically when you leave this field or press Enter.
                </>
              ) : (
                "Now let's check your environment."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ol className="flex items-center gap-2 text-xs" aria-label="Setup steps">
              <li className={cn(step === 1 ? "font-medium text-foreground" : "text-muted-foreground")}>
                1 · Projects root
              </li>
              <li aria-hidden className="text-muted-foreground">
                →
              </li>
              <li className={cn(step === 2 ? "font-medium text-foreground" : "text-muted-foreground")}>
                2 · Environment checks
              </li>
            </ol>

            {step === 1 ? (
              <>
                {notices.map((notice) => (
                  <Notice key={notice.text} kind={notice.kind}>
                    {notice.text}
                  </Notice>
                ))}
                <div className="space-y-2">
                  <Label htmlFor="onboarding-projects-root">Unity projects root</Label>
                  <div className="flex gap-2">
                    <Input
                      id="onboarding-projects-root"
                      className="flex-1"
                      value={projectsRoot}
                      placeholder="/path/to/your/Unity/Projects"
                      onChange={(event) => updateRoot(event.target.value)}
                      onBlur={(event) => {
                        if (!pickerPending.current) commitRoot(event.currentTarget.value);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          commitRoot(event.currentTarget.value);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onMouseDown={() => {
                        pickerPending.current = true;
                      }}
                      onClick={() => {
                        pickerPending.current = true;
                        void pickDirectory({ kind: "dir", title: "Unity projects root" })
                          .then((picked) => {
                            if (picked === null) return;
                            updateRoot(picked);
                            commitRoot(picked);
                          })
                          .catch((err: unknown) => {
                            setSaveError(err instanceof Error ? err.message : String(err));
                          })
                          .finally(() => {
                            pickerPending.current = false;
                          });
                      }}
                    >
                      <FolderOpen />
                      Browse…
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3" aria-live="polite">
                  {saving ? (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                      <LoaderCircle className="size-4 animate-spin" />
                      Saving…
                    </span>
                  ) : null}
                  {saveError ? (
                    <span className="text-sm text-destructive" role="alert">
                      {saveError}
                    </span>
                  ) : null}
                  {saved && discovered ? (
                    <span className="text-sm text-success" role="status">
                      {discovered.count > 0
                        ? `Found ${discovered.count} Unity project${discovered.count === 1 ? "" : "s"} under ${discovered.root}`
                        : `No Unity projects under ${discovered.root} yet — you can still continue.`}
                    </span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                {summary ? <Notice kind={summary.kind}>{summary.text}</Notice> : null}
                {checkError ? <Notice kind="error">{checkError}</Notice> : null}
                <div className="space-y-3">
                  {checking ? (
                    <div className="flex items-center gap-2 py-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      <p className="text-sm text-muted-foreground" role="status">
                        Running checks…
                      </p>
                    </div>
                  ) : report ? (
                    <ul className="space-y-2 rounded-md border bg-muted/20 p-3" aria-live="polite">
                      {report.reports.map((r) => (
                        <DoctorRow key={r.id} report={r} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Run the checks to see your environment status.</p>
                  )}
                  <Button type="button" variant="outline" disabled={checking} onClick={() => void runChecks()}>
                    Re-run checks
                  </Button>
                </div>
              </>
            )}

            <div className="flex items-center justify-between border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={onSkip}>
                Skip for now
              </Button>
              <div className="flex items-center gap-2">
                {step === 1 ? (
                  <Button type="button" disabled={!continueEnabled} onClick={() => setStep(2)}>
                    Continue
                  </Button>
                ) : (
                  <>
                    <Button ref={stepTwoBackRef} type="button" variant="outline" onClick={() => setStep(1)}>
                      Back
                    </Button>
                    <Button type="button" onClick={onDone}>
                      Finish
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
      </Card>
    </div>
  );
}
