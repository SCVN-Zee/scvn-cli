/**
 * components/sidebar.tsx — Sticky, collapsible capability rail (shadcn style).
 *
 * Sits flush against the window's left edge at full height (it never scrolls
 * with the content pane). Collapses to a ~3.25rem icon rail; collapsed items
 * reveal their label in a right-side tooltip. Width animates with the iOS-style
 * drawer curve under 300ms. Controlled: `collapsed` + `onToggle` are owned by
 * the shell so a topbar button and a keyboard shortcut can drive the same state.
 */

import { ChevronsLeft, ChevronsRight } from "lucide-react";

import logoUrl from "@/assets/logo.png";

import type { CapabilitySpec } from "@shared/commands";
import { cn } from "@/lib/utils";
import { capabilityIcon } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

declare const __APP_VERSION__: string | undefined;
const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

export interface SidebarProps {
  items: CapabilitySpec[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function NavItem({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: CapabilitySpec;
  active: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
}) {
  const Icon = capabilityIcon(item.id);
  const button = (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      data-active={active}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2.5 h-9 text-sm outline-none",
        "text-sidebar-foreground/75 transition-[color,background-color] duration-150 ease-[var(--ease-out)]",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
      {active && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
    </button>
  );

  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ items, selectedId, onSelect, collapsed, onToggle }: SidebarProps) {
  const mainItems = items.filter((i) => i.id !== "settings");
  const settingsItem = items.find((i) => i.id === "settings");
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "transition-[width] duration-200 ease-[var(--ease-drawer)]",
        collapsed ? "w-[3.25rem]" : "w-64",
      )}
    >
      <div className="app-drag h-8 shrink-0" />
      <div className={cn("flex h-14 items-center gap-2.5 px-3", collapsed && "justify-center px-0")}>
        <img
          src={logoUrl}
          alt="Supercent VN Tools"
          className="size-8 shrink-0 rounded-full"
          draggable={false}
        />
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-semibold">Supercent VN Tools</span>
            <span className="truncate text-[10px] font-medium tracking-wider text-muted-foreground">
              {APP_VERSION ? `v${APP_VERSION}` : "Control Center"}
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {!collapsed && (
          <p className="px-2.5 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Capabilities
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {mainItems.map((item) => (
            <li key={item.id}>
              <NavItem
                item={item}
                active={item.id === selectedId}
                collapsed={collapsed}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      </nav>

      <Separator className="bg-sidebar-border" />

      <div
        className={cn(
          "flex p-2",
          collapsed ? "flex-col items-center gap-1" : "items-center justify-between gap-2",
        )}
      >
        {settingsItem && (
          <div className={cn(collapsed ? "w-full" : "min-w-0 flex-1")}>
            <NavItem
              item={settingsItem}
              active={settingsItem.id === selectedId}
              collapsed={collapsed}
              onSelect={onSelect}
            />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="size-8 shrink-0 text-muted-foreground hover:text-sidebar-accent-foreground"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        </Button>
      </div>
    </aside>
  );
}
