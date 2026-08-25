/**
 * features/mcp/mcp-constants.ts — Package names, registries, and import roots.
 *
 * Single source of truth, ported from unity-mcp-localize.sh:77-93. There is
 * deliberately no "all packages" constant: the authoritative set is derived per
 * scope — a version dir's versions.json says what was STAGED, a repo's marker
 * says what is INSTALLED.
 */

/** OpenUPM hosts the Unity packages; both registries speak the npm protocol. */
export const OPENUPM_REGISTRY = "https://package.openupm.com";
/** npm hosts `unity-mcp-cli` (the tool that writes .mcp.json). */
export const NPM_REGISTRY = "https://registry.npmjs.org";

export const CORE_PKG = "com.ivanmurzak.unity.mcp";
export const PPX_PKG = "extensions.unity.playerprefsex";

/** Addon seed for a fresh install; `--addons` overrides it. */
export const DEFAULT_ADDONS: readonly string[] = [
  "com.ivanmurzak.unity.mcp.animation",
  "com.ivanmurzak.unity.mcp.particlesystem",
];

/** The addon namespace a bare `--addons` shorthand expands into. */
export const ADDON_NAMESPACE = "com.ivanmurzak.unity.mcp.";

/** The npm package that derives a project's MCP port and writes .mcp.json. */
export const CLI_PKG = "unity-mcp-cli";

/** Vendored-source import root, relative to the Unity project dir. Git-excluded, never committed. */
export const WIRE_SUBDIR = "Assets/UnityMCP";
/** Plugin-restored NuGet DLLs. Git-excluded; scvn never manages them, only purges on request. */
export const NUGET_SUBDIR = "Assets/Plugins/NuGet";
/** The agent MCP config unity-mcp-cli writes into the Unity project dir. Also git-excluded. */
export const MCP_JSON = ".mcp.json";

/**
 * The three files that must stay byte-equal to HEAD: vendoring as source means
 * UPM is never involved, so a diff here proves something else touched them.
 */
export const MACHINERY_FILES: readonly string[] = [
  "Packages/manifest.json",
  "Packages/packages-lock.json",
  "ProjectSettings/PackageManagerSettings.asset",
];
