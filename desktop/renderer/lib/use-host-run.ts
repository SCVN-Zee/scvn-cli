/**
 * lib/use-host-run.ts — Streaming invocation hook shared by the run view and
 * the embedded Doctor panel.
 *
 * Owns the event plumbing for one in-flight host command: it subscribes to
 * `window.scvn.onEvent` BEFORE calling invoke (so the first host event can
 * never race the subscription), accumulates output/progress into log lines,
 * surfaces the current prompt-request, and tracks status. `start` can be
 * called again to re-run (Doctor's "Run checks" button); the previous
 * subscription is dropped first.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { bridge, cancelRun, respondPrompt } from "@/lib/bridge";
import type { FromHost, PromptValue } from "@shared/ipc";

export type RunStatus = "idle" | "running" | "done" | "failed";
export type LogLine = { cls: string; text: string };
export type PromptRequest = Extract<FromHost, { kind: "prompt-request" }>;

/** Render a capability's result value as a concise success line. */
export function formatResult(value: unknown): string {
  if (value === undefined || value === null) return "✓ Completed";
  if (typeof value === "string") return value.trim() === "" ? "✓ Completed" : `✓ ${value}`;
  if (typeof value === "number" || typeof value === "boolean") return `✓ ${String(value)}`;
  return `✓ Completed · ${JSON.stringify(value)}`;
}

export interface HostRun {
  lines: LogLine[];
  status: RunStatus;
  prompt: PromptRequest | null;
  cancelling: boolean;
  start: (command: string, args?: unknown) => void;
  resolvePrompt: (value: PromptValue | null) => void;
  cancel: () => void;
}

/** Tailwind class for a log line's severity/kind. */
export function logLineClass(cls: string): string {
  if (cls === "error") return "text-destructive";
  if (cls === "warn") return "text-warning";
  if (cls === "success" || cls === "result") return "text-success";
  if (cls === "progress") return "text-muted-foreground";
  if (cls === "step") return "text-foreground";
  return "text-muted-foreground";
}

export function useHostRun(): HostRun {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const requestIdRef = useRef<string | null>(null);
  const statusRef = useRef<RunStatus>("idle");
  const offRef = useRef<(() => void) | null>(null);
  statusRef.current = status;

  useEffect(() => () => offRef.current?.(), []);

  const start = useCallback((command: string, args?: unknown) => {
    offRef.current?.();
    setLines([]);
    setPrompt(null);
    setCancelling(false);
    setStatus("running");
    statusRef.current = "running";

    const scvn = bridge();
    let requestId: string | null = null;

    function handle(message: FromHost): void {
      switch (message.kind) {
        case "output-event":
          setLines((prev) => [...prev, { cls: message.event.level, text: message.event.message }]);
          break;
        case "progress-event":
          setLines((prev) => [
            ...prev,
            {
              cls: "progress",
              text: `⟳ ${message.event.phase}${message.event.message ? ": " + message.event.message : ""}`,
            },
          ]);
          break;
        case "prompt-request":
          if (statusRef.current === "running") setPrompt(message);
          break;
        case "result":
          setLines((prev) => [...prev, { cls: "result", text: formatResult(message.value) }]);
          statusRef.current = "done";
          setStatus("done");
          setPrompt(null);
          break;
        case "error":
          setLines((prev) => [...prev, { cls: "error", text: `✗ ${message.name}: ${message.message}` }]);
          statusRef.current = "failed";
          setStatus("failed");
          setPrompt(null);
          break;
        default: {
          const _never: never = message;
          void _never;
        }
      }
    }

    // Subscribe before invoke so the first host event cannot be missed.
    const off = scvn.onEvent((m: FromHost) => {
      if (m.requestId !== requestId) return;
      handle(m);
    });
    offRef.current = off;
    requestId = args === undefined ? scvn.invoke(command) : scvn.invoke(command, args);
    requestIdRef.current = requestId;
  }, []);

  const resolvePrompt = useCallback((value: PromptValue | null) => {
    const requestId = requestIdRef.current;
    setPrompt((prev) => {
      if (requestId === null || prev === null) return prev;
      respondPrompt(requestId, prev.promptId, value);
      return null;
    });
  }, []);

  const cancel = useCallback(() => {
    const requestId = requestIdRef.current;
    if (requestId === null) return;
    cancelRun(requestId);
    setCancelling(true);
  }, []);

  return { lines, status, prompt, cancelling, start, resolvePrompt, cancel };
}
