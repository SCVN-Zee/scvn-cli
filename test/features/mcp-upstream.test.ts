import { afterEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { tmpDir } from "../helpers/tmp-dir.js";
import { markerPath } from "../../src/features/mcp/marker.js";
import { readUpstreamProjectState } from "../../src/features/mcp/upstream-status.js";
import {
  hasGeneratedAgentConfig,
  PROJECT_LOCAL_AGENTS,
  relocateMcpArtifacts,
  relocateMcpSkills,
  runMcpLifecycle,
} from "../../src/features/mcp/upstream.js";

vi.mock("../../src/features/mcp/install-mcp.js", () => ({
  installMcp: vi.fn(async () => {}),
}));
vi.mock("../../src/features/mcp/update-mcp.js", () => ({
  updateMcp: vi.fn(async () => {}),
}));
vi.mock("../../src/features/mcp/reconfigure-mcp.js", () => ({
  reconfigureMcp: vi.fn(async () => {}),
}));
vi.mock("../../src/features/mcp/uninstall-mcp.js", () => ({
  uninstallMcp: vi.fn(async () => {}),
}));
const detectState = vi.hoisted(() => ({ running: false }));
vi.mock("../../src/detectors/detect-unity-running.js", () => ({
  detectUnityRunning: async () => detectState.running,
}));

async function installMarker(project: string): Promise<void> {
  const file = markerPath(project);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({
    coreVersion: "0.9.0",
    packages: { "com.ivanmurzak.unity.mcp": "0.9.0" },
    source: "test",
    importedAt: new Date().toISOString(),
  }));
}

async function makeProject(): Promise<{ repo: string; project: string; target: string }> {
  const repo = await tmpDir("scvn-mcp-upstream-");
  const project = path.join(repo, "unity");
  const target = path.join(project, "Assets");
  await mkdir(path.join(project, "Packages"), { recursive: true });
  await mkdir(target, { recursive: true });
  await writeFile(path.join(project, "Packages", "manifest.json"), "{}\n");
  await mkdir(path.join(project, "UserSettings"), { recursive: true });
  await writeFile(path.join(project, "UserSettings", "AI-Game-Developer-Config.json"), JSON.stringify({ host: "http://localhost:26782" }));
  await execa("git", ["init", "-q"], { cwd: repo });
  return { repo, project, target };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

  it("validates catalog-specific JSON and TOML agent entries", () => {
    const claude = PROJECT_LOCAL_AGENTS.find(({ value }) => value === "claude-code")!;
    const codex = PROJECT_LOCAL_AGENTS.find(({ value }) => value === "codex")!;

    expect(hasGeneratedAgentConfig(JSON.stringify({ mcpServers: { unrelated: {} } }), claude)).toBe(false);
    expect(hasGeneratedAgentConfig(JSON.stringify({ mcpServers: { "ai-game-developer": {} } }), claude)).toBe(true);
    expect(hasGeneratedAgentConfig("[mcp_servers.other]\ncommand = \"node\"\n", codex)).toBe(false);
    expect(hasGeneratedAgentConfig("[mcp_servers.ai-game-developer]\ncommand = \"node\"\n", codex)).toBe(true);
  });

describe("MCP upstream contracts", () => {
  afterEach(() => {
    detectState.running = false;
  });
  it("reads installed state from the project marker, not package manifests", async () => {
    const { repo, project, target } = await makeProject();
    expect(await readUpstreamProjectState(target)).toEqual({ installed: false, version: null, extensions: [], agent: null, enableAllTools: true, enableAllPrompts: true, enableAllResources: true });

    await mkdir(path.dirname(markerPath(project)), { recursive: true });
    await writeFile(markerPath(project), JSON.stringify({
      coreVersion: "0.9.0",
      packages: {
        "com.ivanmurzak.unity.mcp": "0.9.0",
        "com.ivanmurzak.unity.mcp.animation": "1.0.0",
      },
    }));
    await mkdir(path.join(project, "UserSettings"), { recursive: true });
    await writeFile(path.join(project, "UserSettings", "AI-Game-Developer-Config.json"), JSON.stringify({
      tools: [{ enabled: false }],
      prompts: [],
      resources: [{ enabled: false }],
    }));
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { unrelated: { command: "keep" } } }));
    expect((await readUpstreamProjectState(target)).agent).toBeNull();
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { unrelated: { command: "keep" }, "ai-game-developer": { command: "generated" } } }));
    expect(await readUpstreamProjectState(target)).toEqual({
      installed: true,
      version: "0.9.0",
      extensions: ["com.ivanmurzak.unity.mcp.animation"],
      agent: "claude-code",
      enableAllTools: false,
      enableAllPrompts: true,
      enableAllResources: false,
    });
  });
  it("relocates only the generated agent config entry", async () => {
    const { repo, project } = await makeProject();
    await writeFile(path.join(project, ".mcp.json"), JSON.stringify({
      mcpServers: { "ai-game-developer": { command: "node", args: ["generated"] } },
    }));
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({
      mcpServers: { existing: { command: "other" } },
    }));

    const result = await relocateMcpArtifacts(project, repo, "claude-code");
    expect(result.configPath).toBe(path.join(repo, ".mcp.json"));
    expect(JSON.parse(await readFile(result.configPath, "utf8"))).toEqual({
      mcpServers: {
        existing: { command: "other" },
        "ai-game-developer": { command: "node", args: ["generated"] },
      },
    });
    await expect(readFile(path.join(project, ".mcp.json"))).rejects.toThrow();
  });
  it("relocates generated skills and rejects an empty generator result", async () => {
    const { repo, project } = await makeProject();
    await expect(relocateMcpSkills(project, repo, "claude-code")).rejects.toThrow("no generated SKILL.md files");
    const source = path.join(project, ".claude", "skills", "unity-mcp");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "SKILL.md"), "# generated\n");

    const result = await relocateMcpSkills(project, repo, "claude-code");

    expect(result.skillCount).toBe(1);
    await expect(readFile(path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# generated\n");
    await expect(access(path.join(project, ".claude", "skills", "unity-mcp", "SKILL.md"))).rejects.toThrow();
    await expect(access(path.join(project, ".claude"))).rejects.toThrow();
  });
  it("replaces changed generator skills but preserves unrelated pre-existing dirs", async () => {
    const { repo, project } = await makeProject();
    const sourceRoot = path.join(project, ".claude", "skills");
    await mkdir(path.join(sourceRoot, "unrelated"), { recursive: true });
    await mkdir(path.join(sourceRoot, "generated"), { recursive: true });
    await writeFile(path.join(sourceRoot, "unrelated", "SKILL.md"), "# keep\n");
    await writeFile(path.join(sourceRoot, "generated", "SKILL.md"), "# generated\n");
    await mkdir(path.join(repo, ".claude", "skills", "generated"), { recursive: true });
    await writeFile(path.join(repo, ".claude", "skills", "generated", "SKILL.md"), "# existing\n");

    const result = await relocateMcpSkills(project, repo, "claude-code", new Map([["unrelated/SKILL.md", Buffer.from("# keep\n")]]));

    expect(result.skillCount).toBe(1);
    await expect(readFile(path.join(repo, ".claude", "skills", "generated", "SKILL.md"), "utf8")).resolves.toBe("# generated\n");
    await expect(readFile(path.join(sourceRoot, "unrelated", "SKILL.md"), "utf8")).resolves.toBe("# keep\n");
  });
  it("prunes identically rewritten skills on rerun without touching the repo copy", async () => {
    const { repo, project } = await makeProject();
    const skillPath = path.join(project, ".claude", "skills", "unity-mcp", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v1\n");
    await relocateMcpSkills(project, repo, "claude-code");
    // The plugin regenerates identical output into the project on every run.
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v1\n");
    const before = new Map([["unity-mcp/SKILL.md", Buffer.from("# v1\n")]]);

    const result = await relocateMcpSkills(project, repo, "claude-code", before, Date.now() - 1000);

    expect(result.skillCount).toBe(1);
    await expect(readFile(path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# v1\n");
    await expect(access(path.join(project, ".claude"))).rejects.toThrow();
  });
  it("updates an installed skill when regeneration changes its content", async () => {
    const { repo, project } = await makeProject();
    const skillPath = path.join(project, ".claude", "skills", "unity-mcp", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v1\n");
    await relocateMcpSkills(project, repo, "claude-code");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v2\n");
    const before = new Map([["unity-mcp/SKILL.md", Buffer.from("# v1\n")]]);

    const result = await relocateMcpSkills(project, repo, "claude-code", before, Date.now() - 1000);

    expect(result.skillCount).toBe(1);
    await expect(readFile(path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# v2\n");
    await expect(access(path.join(project, ".claude"))).rejects.toThrow();
  });
  it("rejects a skills root that produced no SKILL.md files", async () => {
    const { repo, project } = await makeProject();
    const sourceRoot = path.join(project, ".claude", "skills");
    await mkdir(path.join(sourceRoot, "notes"), { recursive: true });
    await writeFile(path.join(sourceRoot, "notes", "README.md"), "not a skill\n");

    await expect(relocateMcpSkills(project, repo, "claude-code")).rejects.toThrow(
      "no generated SKILL.md files",
    );
  });
  it.skipIf(process.getuid?.() === 0)("keeps the installed skill when relocation fails mid-copy", async () => {
    const { repo, project } = await makeProject();
    const skillsRoot = path.join(repo, ".claude", "skills");
    const skillPath = path.join(project, ".claude", "skills", "unity-mcp", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v1\n");
    await relocateMcpSkills(project, repo, "claude-code");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# v2\n");
    const before = new Map([["unity-mcp/SKILL.md", Buffer.from("# v1\n")]]);
    await chmod(skillsRoot, 0o500);
    try {
      await expect(
        relocateMcpSkills(project, repo, "claude-code", before, Date.now() - 1000),
      ).rejects.toThrow();
      await expect(readFile(path.join(skillsRoot, "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# v1\n");
    } finally {
      await chmod(skillsRoot, 0o700);
    }
  });
  it("verifies generated skills in place when the Unity project is the repo root", async () => {
    const repo = await tmpDir("scvn-mcp-root-");
    const skillPath = path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, "# generated\n");

    const result = await relocateMcpSkills(repo, repo, "claude-code");

    expect(result.skillCount).toBe(1);
    await expect(readFile(skillPath, "utf8")).resolves.toBe("# generated\n");
  });

  it("keeps generated MCP config and skills at the repository root", async () => {
    const { repo, project, target } = await makeProject();
    const calls: string[] = [];
    const unrelated = path.join(project, ".claude", "skills", "unrelated");
    await mkdir(unrelated, { recursive: true });
    await writeFile(path.join(unrelated, "SKILL.md"), "# keep\n");
    await runMcpLifecycle({
      target,
      verb: "install",
      pluginVersion: "0.9.0",
      extensions: [],
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "setup-mcp") {
          await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "ai-game-developer": { url: "http://localhost:26782/p/test" } } }));
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toEqual(["configure", "setup-mcp"]);
    expect(JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8")).mcpServers["ai-game-developer"].url).toBe("http://localhost:26782/p/test");
  });
  it("does not run live-Editor skills during install", async () => {
    const { repo, project, target } = await makeProject();
    const configPath = path.join(project, ".mcp.json");
    const original = Buffer.from(JSON.stringify({ mcpServers: { existing: { command: "keep" } } }));
    await writeFile(configPath, original);
    const calls: string[] = [];

    await runMcpLifecycle({
      target,
      verb: "install",
      pluginVersion: "0.9.0",
      extensions: [],
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "setup-mcp") {
          await writeFile(configPath, JSON.stringify({ mcpServers: { "ai-game-developer": { url: "http://localhost:26782/p/fresh" } } }));
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toEqual(["configure", "setup-mcp"]);
    await expect(readFile(configPath)).resolves.toEqual(original);
    await expect(readFile(path.join(repo, ".mcp.json"), "utf8")).resolves.toContain("http://localhost:26782/p/fresh");
  });
  it("resumes skill generation without package mutation", async () => {
    const { repo, project, target } = await makeProject();
    const calls: string[] = [];
    await runMcpLifecycle({
      target,
      verb: "skills",
      agent: "claude-code",
      run: async (args) => {
              calls.push(args[0] ?? "");
              if (args[0] === "setup-mcp") {
                await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "ai-game-developer": { command: "test" } } }));
              }
              const skillDir = path.join(project, ".claude", "skills", "unity-mcp");
              await mkdir(skillDir, { recursive: true });
              await writeFile(path.join(skillDir, "SKILL.md"), "# generated\n");
              return { exitCode: 0, stdout: "", stderr: "" };
            },
    });
    expect(calls).toEqual(["setup-mcp", "setup-skills"]);
    await expect(readFile(path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# generated\n");
  });

  it("does not change capability flags during skills resume", async () => {
    const { project, target } = await makeProject();
    const settingsPath = path.join(project, "UserSettings", "AI-Game-Developer-Config.json");
    const original = JSON.stringify({
      host: "http://localhost:26782",
      tools: [{ enabled: false }],
      prompts: [{ enabled: false }],
      resources: [{ enabled: false }],
    });
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, original);
    const calls: string[] = [];

    await runMcpLifecycle({
      target,
      verb: "skills",
      agent: "claude-code",
      enableAllTools: true,
      enableAllPrompts: true,
      enableAllResources: true,
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "configure") await writeFile(settingsPath, JSON.stringify({ tools: [], prompts: [], resources: [] }));
        if (args[0] === "setup-mcp") await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "ai-game-developer": { command: "test" } } }));
        if (args[0] === "setup-skills") {
          const skillDir = path.join(project, ".claude", "skills", "unity-mcp");
          await mkdir(skillDir, { recursive: true });
          await writeFile(path.join(skillDir, "SKILL.md"), "# generated\n");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(calls).toEqual(["setup-mcp", "setup-skills"]);
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(original);
  });

  it("finish opens Unity, waits for ready, then generates skills", async () => {
    const { repo, project, target } = await makeProject();
    await installMarker(project);
    const calls: string[] = [];
    let sawTimeout = false;
    await runMcpLifecycle({
      target,
      verb: "finish",
      agent: "claude-code",
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "wait-for-ready") sawTimeout = args.includes("600000");
        if (args[0] === "setup-mcp") await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "ai-game-developer": { command: "test" } } }));
        if (args[0] === "setup-skills") {
          const skillDir = path.join(project, ".claude", "skills", "unity-mcp");
          await mkdir(skillDir, { recursive: true });
          await writeFile(path.join(skillDir, "SKILL.md"), "# generated\n");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(calls).toEqual(["configure", "open", "wait-for-ready", "setup-mcp", "setup-skills"]);
    expect(sawTimeout).toBe(true);
    await expect(readFile(path.join(repo, ".claude", "skills", "unity-mcp", "SKILL.md"), "utf8")).resolves.toBe("# generated\n");
    await expect(readFile(path.join(repo, ".mcp.json"), "utf8")).resolves.toContain("ai-game-developer");
  });

  it("finish refuses an uninstalled project", async () => {
    const { target } = await makeProject();
    const calls: string[] = [];
    await expect(runMcpLifecycle({
      target,
      verb: "finish",
      agent: "claude-code",
      run: async (args) => {
        calls.push(args[0] ?? "");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("run install first");
    expect(calls).toEqual([]);
  });

  it("finish skips open and configure when Unity already runs with unchanged flags", async () => {
    const { project, target } = await makeProject();
    await installMarker(project);
    detectState.running = true;
    const calls: string[] = [];
    await runMcpLifecycle({
      target,
      verb: "finish",
      agent: "claude-code",
      run: async (args) => {
        calls.push(args[0] ?? "");
        if (args[0] === "setup-mcp") await writeFile(path.join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "ai-game-developer": { command: "test" } } }));
        if (args[0] === "setup-skills") {
          const skillDir = path.join(project, ".claude", "skills", "unity-mcp");
          await mkdir(skillDir, { recursive: true });
          await writeFile(path.join(skillDir, "SKILL.md"), "# generated\n");
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    expect(calls).toEqual(["wait-for-ready", "setup-mcp", "setup-skills"]);
  });

  it("finish refuses changed flags while Unity runs, before any wait or skills", async () => {
    const { project, target } = await makeProject();
    await installMarker(project);
    const settingsPath = path.join(project, "UserSettings", "AI-Game-Developer-Config.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, JSON.stringify({ tools: [{ name: "X", enabled: false }], prompts: [], resources: [] }));
    detectState.running = true;
    const calls: string[] = [];
    await expect(runMcpLifecycle({
      target,
      verb: "finish",
      agent: "claude-code",
      run: async (args) => {
        calls.push(args[0] ?? "");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("close it (or revert the toggles)");
    expect(calls).toEqual([]);
  });

  it("refuses a non-local host without replacing the existing agent config", async () => {
    const { repo, project, target } = await makeProject();
    await writeFile(path.join(project, "UserSettings", "AI-Game-Developer-Config.json"), JSON.stringify({ host: "https://ai-game.dev/mcp" }));
    const configPath = path.join(repo, ".mcp.json");
    const original = JSON.stringify({ mcpServers: { existing: { command: "keep" } } });
    await writeFile(configPath, original);
    await expect(runMcpLifecycle({ target, verb: "skills", run: async () => {
      throw new Error("must not invoke the generator");
    } })).rejects.toThrow("Set a local MCP host");
    expect(await readFile(configPath, "utf8")).toBe(original);
  });
  it("keeps config when resumed skills fail at repo root", async () => {
    const repo = await tmpDir("scvn-mcp-root-lifecycle-");
    const target = path.join(repo, "Assets");
    await mkdir(path.join(repo, "Packages"), { recursive: true });
    await mkdir(target, { recursive: true });
    await writeFile(path.join(repo, "Packages", "manifest.json"), "{}\n");
    await mkdir(path.join(repo, "UserSettings"), { recursive: true });
    await writeFile(path.join(repo, "UserSettings", "AI-Game-Developer-Config.json"), JSON.stringify({ host: "http://localhost:26782" }));
    await execa("git", ["init", "-q"], { cwd: repo });
    await writeFile(path.join(repo, ".mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "keep" } } }));
    const config = { mcpServers: { "ai-game-developer": { command: "generated" } } };

    await expect(runMcpLifecycle({
      target,
      verb: "skills",
      agent: "claude-code",
      run: async (args) => {
        if (args[0] === "setup-mcp")
          await writeFile(path.join(repo, ".mcp.json"), JSON.stringify(config));
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("the CLI produced no generated SKILL.md files");
    expect(JSON.parse(await readFile(path.join(repo, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { existing: { command: "keep" }, "ai-game-developer": { command: "generated" } },
    });
    await expect(readFile(path.join(repo, ".mcp.json"), "utf8")).resolves.toContain("generated");
  });

  it("rejects a successful setup-mcp stage that produces no config", async () => {
    const { repo, target } = await makeProject();
    const calls: string[] = [];

    await expect(runMcpLifecycle({
      target,
      verb: "skills",
      agent: "claude-code",
      run: async (args) => {
        calls.push(args[0] ?? "");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("the CLI produced no agent config");

    expect(calls).toEqual(["setup-mcp"]);
    await expect(access(path.join(repo, ".mcp.json"))).rejects.toThrow();
  });

  it("dry-run does not execute commands or change the filesystem", async () => {
    const { repo, project, target } = await makeProject();
    const before = (await execa("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo })).stdout;
    const commands: string[][] = [];

    await runMcpLifecycle({
      target,
      verb: "install",
      pluginVersion: "0.9.0",
      extensions: [],
      enableAllTools: false,
      enableAllPrompts: false,
      enableAllResources: false,
      dryRun: true,
      run: async (args) => {
        commands.push([...args]);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    expect(commands).toEqual([]);
    expect((await execa("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo })).stdout).toBe(before);
    expect(await exists(path.join(project, ".mcp.json"))).toBe(false);
    expect(await exists(path.join(repo, ".mcp.json"))).toBe(false);
    expect((await readdir(repo)).filter((name) => name.startsWith(".scvn-mcp-config-")).length).toBe(0);
  });
  it("restores the existing agent config when setup-mcp fails", async () => {
    const { project, target } = await makeProject();
    const configPath = path.join(project, ".mcp.json");
    const original = Buffer.from(JSON.stringify({
      mcpServers: { existing: { command: "keep" } },
    }));
    await writeFile(configPath, original);

    const calls: string[][] = [];
    await expect(runMcpLifecycle({
      target,
      verb: "install",
      pluginVersion: "0.9.0",
      extensions: [],
      run: async (args) => {
        calls.push([...args]);
        if (args[0] === "setup-mcp") {
          await writeFile(configPath, JSON.stringify({
            mcpServers: { broken: { command: "partial" } },
          }));
          return { exitCode: 1, stdout: "", stderr: "upstream failed" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    })).rejects.toThrow("setup-mcp stage failed: setup-mcp: upstream failed");

    expect(calls.map(([command]) => command)).toEqual(["configure", "setup-mcp"]);
    expect(await readFile(configPath)).toEqual(original);
    expect(await exists(path.join(project, ".scvn-mcp-config.tmp"))).toBe(false);
  });
});
