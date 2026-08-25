/**
 * commands/shared/select-mcp-addons.ts — Interactive addon picker for `scvn mcp install`.
 *
 * MCP_ADDON_OPTIONS is the canonical addon catalog — every addon, cinemachine
 * included, is a normal installable option. The two seed addons are pre-checked:
 * they are what a default install ships.
 */

import { DEFAULT_ADDONS, ADDON_NAMESPACE } from "../../features/mcp/mcp-constants.js";
import type { PromptAdapter } from "../../ui/prompt.js";

/** The canonical addon catalog `scvn mcp` can vendor, in picker order. */
export const MCP_ADDON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "com.ivanmurzak.unity.mcp.animation", label: "Animation" },
  { value: "com.ivanmurzak.unity.mcp.cinemachine", label: "Cinemachine" },
  { value: "com.ivanmurzak.unity.mcp.inputsystem", label: "InputSystem" },
  { value: "com.ivanmurzak.unity.mcp.navigation", label: "Navigation" },
  { value: "com.ivanmurzak.unity.mcp.particlesystem", label: "ParticleSystem" },
  { value: "com.ivanmurzak.unity.mcp.probuilder", label: "ProBuilder" },
  { value: "com.ivanmurzak.unity.mcp.splines", label: "Splines" },
  { value: "com.ivanmurzak.unity.mcp.terrain", label: "Terrain" },
  { value: "com.ivanmurzak.unity.mcp.tilemap", label: "Tilemap" },
  { value: "com.ivanmurzak.unity.mcp.timeline", label: "Timeline" },
];

/** Short display name for an addon package. */
export function addonLabel(pkg: string): string {
  return pkg.startsWith(ADDON_NAMESPACE) ? pkg.slice(ADDON_NAMESPACE.length) : pkg;
}

/** Ask which addons to vendor. Returns full package names; [] is a valid answer. */
export async function selectMcpAddons(prompt: PromptAdapter): Promise<string[]> {
  return prompt.multiselect({
    message: "Select MCP addons (space to toggle, enter to confirm)",
    options: MCP_ADDON_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.label,
    })),
    initialValues: [...DEFAULT_ADDONS],
    required: false,
  });
}
