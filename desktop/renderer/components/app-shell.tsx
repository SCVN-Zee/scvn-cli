/**
 * components/app-shell.tsx — Top-level layout: sticky sidebar + topbar + pane.
 *
 * Owns the sidebar collapse state (persisted to localStorage, toggled by the
 * sidebar chevron or ⌘/Ctrl-B). The content pane is the only scrolling region,
 * so the sidebar stays pinned to the window edge. A draggable top inset in each
 * column clears the macOS traffic lights (window uses titleBarStyle hiddenInset)
 * and gives the frameless window a drag handle.
 */

import * as React from "react";

import type { CapabilitySpec } from "@shared/commands";
import { Sidebar } from "@/components/sidebar";
import { UpdateBanner } from "@/components/update-banner";

const COLLAPSE_KEY = "scvn.sidebar.collapsed";

function useSidebarCollapsed(shortcutsEnabled = true): [boolean, () => void] {
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable — in-memory only */
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    if (!shortcutsEnabled) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsEnabled, toggle]);

  return [collapsed, toggle];
}

export interface AppShellProps {
  items: CapabilitySpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  title: string;
  /** Reopen the first-run setup guide (sidebar "?" button). */
  onReplaySetup: () => void;
  banner?: React.ReactNode;
  children: React.ReactNode;
  /** First-run setup is rendered above the shell without replacing its route. */
  setupOpen?: boolean;
  setup?: React.ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function SetupDialog({
  children,
  open,
  openerFallback,
}: {
  children: React.ReactNode;
  open: boolean;
  openerFallback: HTMLElement | null;
}) {
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);
  const wasOpenRef = React.useRef(false);

  React.useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const active = document.activeElement;
      const activeOpener =
        active instanceof HTMLElement && active !== document.body && active.isConnected ? active : null;
      const replayFallback =
        openerFallback?.isConnected
          ? openerFallback
          : document.querySelector<HTMLElement>('button[aria-label="Replay setup"]');
      openerRef.current = activeOpener ?? replayFallback;

      const dialog = dialogRef.current;
      if (dialog) {
        const first = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        (first ?? dialog).focus();
      }
    } else if (!open && wasOpenRef.current) {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('button[aria-label="Replay setup"]')?.focus();
      openerRef.current = null;
    }
    wasOpenRef.current = open;
  }, [open, openerFallback]);

  if (!open) return null;

  function containFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
    );
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const active = document.activeElement;
    const currentIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : currentIndex === focusable.length - 1
        ? 0
        : currentIndex + 1;
    event.preventDefault();
    focusable[nextIndex]?.focus();
  }
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-8 md:items-center md:pt-8">
      <div aria-hidden="true" className="pointer-events-auto absolute inset-0 bg-background/80 backdrop-blur-[2px]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-dialog-title"
        aria-describedby="onboarding-dialog-description"
        aria-keyshortcuts="Tab"
        tabIndex={-1}
        data-setup-dialog
        className="no-drag pointer-events-auto relative z-10 max-h-[calc(100vh-4rem)] w-full max-w-4xl overflow-auto outline-none"
        onKeyDownCapture={containFocus}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}


export function AppShell({
  items,
  selectedId,
  onSelect,
  title,
  banner,
  onReplaySetup,
  children,
  setupOpen = false,
  setup,
}: AppShellProps) {
  const [collapsed, toggle] = useSidebarCollapsed(!setupOpen);
  const setupOpenerRef = React.useRef<HTMLElement | null>(null);
  const rememberSetupOpener = React.useCallback(() => {
    const active = document.activeElement;
    setupOpenerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);
  const captureSetupOpener = React.useCallback(() => {
    rememberSetupOpener();
    onReplaySetup();
  }, [onReplaySetup, rememberSetupOpener]);

  return (
    <>
      <div aria-hidden={setupOpen} inert={setupOpen} className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar
          items={items}
          selectedId={selectedId}
          onSelect={onSelect}
          collapsed={collapsed}
          onToggle={toggle}
          onReplaySetup={captureSetupOpener}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="app-drag h-8 shrink-0" />
          <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
            <h1 className="truncate text-sm font-medium">{title}</h1>
          </header>
          <UpdateBanner />
          {banner ? <div onClickCapture={rememberSetupOpener}>{banner}</div> : null}
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        </div>
      </div>
      <SetupDialog open={setupOpen} openerFallback={setupOpenerRef.current}>{setup}</SetupDialog>
    </>
  );
}
