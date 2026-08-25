/**
 * lib/icons.tsx — Capability → lucide icon mapping for the sidebar/nav.
 */

import {
  Cable,
  GitBranch,
  GitFork,
  Package,
  Settings,
  Boxes,
  type LucideIcon,
} from "lucide-react";

const CAP_ICONS: Record<string, LucideIcon> = {
  fork: GitFork,
  git: GitBranch,
  mcp: Cable,
  packages: Package,
  settings: Settings,
};

/** Icon for a capability id, falling back to a generic box glyph. */
export function capabilityIcon(id: string): LucideIcon {
  return CAP_ICONS[id] ?? Boxes;
}
