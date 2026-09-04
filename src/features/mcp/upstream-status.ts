import path from "node:path";
import { readFile } from "node:fs/promises";
import { getRepoRoot } from "../../services/git.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import { toRealPath } from "../../util/real-path.js";
import { isInstalled, markerPackages, markerVersion } from "./marker.js";
import { hasGeneratedAgentConfig, PROJECT_LOCAL_AGENTS } from "./upstream.js";

const EXTENSION_PREFIX = "com.ivanmurzak.unity.mcp.";
export interface UpstreamProjectState {
  installed: boolean;
  version: string | null;
  extensions: string[];
  agent: string | null;
  enableAllTools: boolean;
  enableAllPrompts: boolean;
  enableAllResources: boolean;
}


async function existingAgent(projectDir: string): Promise<string | null> {
  let repoRoot = projectDir;
  try {
    const resolvedRoot = await getRepoRoot(projectDir);
    if (resolvedRoot !== null) repoRoot = resolvedRoot;
  } catch {
    // A project status probe can run before the project has a Git root.
  }
  for (const agent of PROJECT_LOCAL_AGENTS) {
    for (const root of new Set([repoRoot, projectDir])) {
      try {
        const text = await readFile(path.join(root, agent.configPath), "utf8");
        if (hasGeneratedAgentConfig(text, agent)) return agent.value;
      } catch {
        // Try the next project-local agent config.
      }
    }
  }
  return null;
}

async function capabilityFlags(projectDir: string): Promise<Pick<UpstreamProjectState, "enableAllTools" | "enableAllPrompts" | "enableAllResources">> {
  try {
    const raw = JSON.parse(await readFile(path.join(projectDir, "UserSettings", "AI-Game-Developer-Config.json"), "utf8")) as Record<string, unknown>;
    const allEnabled = (key: "tools" | "prompts" | "resources"): boolean => {
      const entries = raw[key];
      return !Array.isArray(entries) || !entries.some((entry) => (
        typeof entry === "object" && entry !== null && (entry as { enabled?: unknown }).enabled === false
      ));
    };
    return { enableAllTools: allEnabled("tools"), enableAllPrompts: allEnabled("prompts"), enableAllResources: allEnabled("resources") };
  } catch {
    return { enableAllTools: true, enableAllPrompts: true, enableAllResources: true };
  }
}

export async function readUpstreamProjectState(target: string): Promise<UpstreamProjectState> {
  const resolvedTarget = await toRealPath(target);
  await assertUnityAssetsDir(resolvedTarget);
  const projectDir = path.dirname(resolvedTarget);
  const installed = await isInstalled(projectDir);
  if (!installed) return {
    installed: false,
    version: null,
    extensions: [],
    agent: null,
    enableAllTools: true,
    enableAllPrompts: true,
    enableAllResources: true,
  };
  const packages = await markerPackages(projectDir);
  return {
    installed: true,
    version: await markerVersion(projectDir),
    extensions: packages.filter((id) => id.startsWith(EXTENSION_PREFIX)),
    agent: await existingAgent(projectDir),
    ...await capabilityFlags(projectDir),
  };
}
