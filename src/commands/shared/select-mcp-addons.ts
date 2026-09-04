import { DEFAULT_MCP_EXTENSIONS, MCP_EXTENSIONS } from "../../features/mcp/upstream.js";
import type { PromptAdapter } from "../../ui/prompt.js";

/** Shared upstream extension catalog exposed through the existing picker API. */
export const MCP_ADDON_OPTIONS: Array<{ value: string; label: string }> = MCP_EXTENSIONS.map(
  ({ value, label }) => ({ value, label }),
);

/** Short display name for an extension package. */
export function addonLabel(pkg: string): string {
  const prefix = "com.ivanmurzak.unity.mcp.";
  return pkg.startsWith(prefix) ? pkg.slice(prefix.length) : pkg;
}

/** Ask which Unity-MCP extensions to install. An empty answer is valid. */
export async function selectMcpAddons(prompt: PromptAdapter): Promise<string[]> {
  return prompt.multiselect({
    message: "Select Unity-MCP extensions (space to toggle, enter to confirm)",
    options: MCP_ADDON_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.label,
    })),
    initialValues: [...DEFAULT_MCP_EXTENSIONS],
    required: false,
  });
}
