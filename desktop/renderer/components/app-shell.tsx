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

function useSidebarCollapsed(): [boolean, () => void] {
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
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return [collapsed, toggle];
}

export interface AppShellProps {
  items: CapabilitySpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  title: string;
  children: React.ReactNode;
}

export function AppShell({ items, selectedId, onSelect, title, children }: AppShellProps) {
  const [collapsed, toggle] = useSidebarCollapsed();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        items={items}
        selectedId={selectedId}
        onSelect={onSelect}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="app-drag h-8 shrink-0" />
        <header className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </header>
        <UpdateBanner />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
