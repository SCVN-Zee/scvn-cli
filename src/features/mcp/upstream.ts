import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execa } from "execa";
import { getRepoRoot } from "../../services/git.js";
import { toRealPath } from "../../util/real-path.js";
import { assertUnityAssetsDir } from "./assert-unity-project.js";
import type { SyncReporter } from "../transfer/reporter.js";
import {
  writeCacheDir,
  resolveCliForCore,
  cliEntryPath,
} from "./resolve-mcp-cache.js";
import { ensureUnityMcpCli } from "./resolve-unity-mcp-cli.js";
import { markerVersion } from "./marker.js";
import { installMcp } from "./install-mcp.js";
import { updateMcp } from "./update-mcp.js";
import { reconfigureMcp } from "./reconfigure-mcp.js";
import { uninstallMcp } from "./uninstall-mcp.js";
import { detectUnityRunning } from "../../detectors/detect-unity-running.js";
// Package mutation is guarded by each package-owner operation.

export const MCP_EXTENSIONS = [
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
] as const;

export const DEFAULT_MCP_EXTENSIONS = [
  "com.ivanmurzak.unity.mcp.animation",
  "com.ivanmurzak.unity.mcp.particlesystem",
] as const;
export const PROJECT_LOCAL_AGENTS = [
  {
    value: "claude-code",
    label: "Claude Code",
    configPath: ".mcp.json",
    configFormat: "json",
    configKey: "mcpServers",
  },
  {
    value: "cursor",
    label: "Cursor",
    configPath: ".cursor/mcp.json",
    configFormat: "json",
    configKey: "mcpServers",
  },
  {
    value: "vscode-copilot",
    label: "Visual Studio Code (Copilot)",
    configPath: ".vscode/mcp.json",
    configFormat: "json",
    configKey: "servers",
  },
  {
    value: "vs-copilot",
    label: "Visual Studio (Copilot)",
    configPath: ".vs/mcp.json",
    configFormat: "json",
    configKey: "servers",
  },
  {
    value: "rider-junie",
    label: "Rider (Junie)",
    configPath: ".junie/mcp/mcp.json",
    configFormat: "json",
    configKey: "mcpServers",
  },
  {
    value: "gemini",
    label: "Gemini",
    configPath: ".gemini/settings.json",
    configFormat: "json",
    configKey: "mcpServers",
  },
  {
    value: "open-code",
    label: "Open Code",
    configPath: "opencode.json",
    configFormat: "json",
    configKey: "mcp",
  },
  {
    value: "codex",
    label: "Codex",
    configPath: ".codex/config.toml",
    configFormat: "toml",
    configKey: "mcp_servers",
  },
] as const;

export type McpAgentId = (typeof PROJECT_LOCAL_AGENTS)[number]["value"];

const PROJECT_LOCAL_SKILLS = {
  "claude-code": ".claude/skills",
  cursor: ".cursor/skills",
  "vscode-copilot": ".github/skills",
  "vs-copilot": ".github/skills",
  "rider-junie": ".junie/skills",
  gemini: ".gemini/skills",
  "open-code": ".opencode/skills",
  codex: ".agents/skills",
} as const satisfies Record<McpAgentId, string>;

export interface McpCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type McpCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<McpCommandResult>;

export interface McpLifecycleOptions {
  target: string;
  agent?: McpAgentId;
  extensions?: readonly string[];
  addonsRequired?: boolean;
  pluginVersion?: string;
  verb?: "install" | "update" | "reconfigure" | "uninstall" | "skills" | "finish";
  enableAllTools?: boolean;
  enableAllPrompts?: boolean;
  enableAllResources?: boolean;
  dryRun?: boolean;
  force?: boolean;
  purgeNuget?: boolean;
  reporter?: Pick<SyncReporter, "onStatus" | "onLog">;
  run?: McpCommandRunner;
  /** wait-for-ready budget in ms; default 600000 (first-open package compile can take minutes) */
  waitTimeoutMs?: number;
}

export class McpStageError extends Error {
  constructor(
    readonly stage: string,
    message: string,
  ) {
    super(`${stage} stage failed: ${message}`);
    this.name = "McpStageError";
  }
}

function agentFor(id: string): (typeof PROJECT_LOCAL_AGENTS)[number] {
  const agent = PROJECT_LOCAL_AGENTS.find(
    (candidate) => candidate.value === id,
  );
  if (!agent) throw new Error(`Unsupported project-local MCP agent: ${id}`);
  return agent;
}

function extensionIds(values: readonly string[]): string[] {
  const allowed: Set<string> = new Set(
    MCP_EXTENSIONS.map((extension) => extension.value),
  );
  const result: string[] = [];
  for (const value of values) {
    const id = value.startsWith("com.ivanmurzak.")
      ? value
      : `com.ivanmurzak.unity.mcp.${value}`;
    if (!allowed.has(id))
      throw new Error(`Unsupported Unity-MCP extension: ${value}`);
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function report(
  opts: Pick<McpLifecycleOptions, "reporter">,
  message: string,
  level: "info" | "warn" = "info",
): void {
  opts.reporter?.onLog({ ts: Date.now(), level, message });
}

async function runCachedCli(
  cliDir: string,
  args: readonly string[],
  cwd: string,
): Promise<McpCommandResult> {
  const hostExecPath = process.env["SCVN_HOST_EXEC_PATH"];
  // Electron's Node mode leaves the script path in argv; normalize it before Commander parses.
  const cliArgs = hostExecPath
    ? [
        "-e",
        "const script = process.argv[1]; process.argv = [process.argv[0], ...process.argv.slice(2)]; import(script);",
        cliEntryPath(cliDir),
        ...args,
      ]
    : [cliEntryPath(cliDir), ...args];
  const result = await execa(hostExecPath ?? process.execPath, cliArgs, {
    cwd,
    reject: false,
    stdio: "pipe",
    ...(hostExecPath
      ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }
      : {}),
  });
  return {
    exitCode: result.exitCode ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function cachedRun(
  args: readonly string[],
  cwd: string,
): Promise<McpCommandResult> {
  const coreVersion = await markerVersion(cwd);
  if (coreVersion === null)
    throw new Error(
      "local MCP marker has no core version; cannot find cached unity-mcp-cli",
    );
  const cli = await resolveCliForCore(coreVersion, {
    userCacheDir: writeCacheDir(),
  });
  if (cli === null)
    throw new Error(`unity-mcp-cli for core ${coreVersion} is not cached`);
  return runCachedCli(cli.dir, args, cwd);
}

async function resolveCurrentSessionCli(projectDir: string): Promise<string> {
  const coreVersion = await markerVersion(projectDir);
  if (coreVersion === null)
    throw new Error("local MCP marker has no core version after package setup");
  return (
    await ensureUnityMcpCli(coreVersion, {
      cacheDir: writeCacheDir(),
      exact: true,
    })
  ).dir;
}
async function command(
  opts: McpLifecycleOptions,
  stage: string,
  args: readonly string[],
  projectDir: string,
): Promise<void> {
  report(opts, `unity-mcp-cli ${args.join(" ")}`);
  opts.reporter?.onStatus({
    status: "running",
    detail: `${stage}: ${args[0]}`,
  });
  if (opts.dryRun) return;
  const result = await (opts.run ?? cachedRun)(args, projectDir);
  if (result.stdout.trim()) report(opts, result.stdout.trim());
  if (result.stderr.trim()) report(opts, result.stderr.trim(), "warn");
  if (result.exitCode !== 0) {
    const detail =
      result.stderr.trim() || result.stdout.trim() || "exit " + result.exitCode;
    throw new McpStageError(stage, args[0] + ": " + detail);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
function tomlSection(text: string, header: string, source: string): string {
  const start = text.indexOf(header);
  if (start < 0)
    throw new Error(`Generated MCP config has no ${header} section: ${source}`);
  const next = text.indexOf("\n[", start + header.length);
  return text.slice(start, next < 0 ? text.length : next).trimEnd();
}

function replaceTomlSection(
  destination: string,
  generated: string,
  header: string,
  source: string,
): string {
  const generatedSection = tomlSection(generated, header, source);
  const destinationStart = destination.indexOf(header);
  if (destinationStart < 0)
    return `${destination.trimEnd()}\n\n${generatedSection}\n`;
  const destinationNext = destination.indexOf(
    "\n[",
    destinationStart + header.length,
  );
  return `${destination.slice(0, destinationStart)}${generatedSection}${destinationNext < 0 ? "\n" : destination.slice(destinationNext)}`;
}

function removeTomlSection(text: string, header: string): string {
  const start = text.indexOf(header);
  if (start < 0) return text;
  const next = text.indexOf("\n[", start + header.length);
  const remaining =
    `${text.slice(0, start).trimEnd()}\n${next < 0 ? "" : text.slice(next).replace(/^\n+/, "")}`.trim();
  return remaining ? `${remaining}\n` : "";
}

async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tempPath = `${filePath}.scvn-mcp-${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function readOptionalFile(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function restoreFile(
  filePath: string,
  content: Buffer | null,
): Promise<void> {
  if (content === null) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = filePath + ".scvn-mcp-restore-" + randomUUID() + ".tmp";
  try {
    await writeFile(tempPath, content);
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

export function hasGeneratedAgentConfig(text: string, agent: (typeof PROJECT_LOCAL_AGENTS)[number]): boolean {
  if (agent.configFormat === "toml")
    return text.split(/\r?\n/).some((line) => line.trim() === `[${agent.configKey}.ai-game-developer]`);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const body = parsed[agent.configKey];
    return typeof body === "object" && body !== null && !Array.isArray(body) && Object.prototype.hasOwnProperty.call(body, "ai-game-developer");
  } catch {
    return false;
  }
}

async function mergeGeneratedConfig(
  source: string,
  destination: string,
  agent: (typeof PROJECT_LOCAL_AGENTS)[number],
): Promise<void> {
  if (source === destination || !(await exists(source))) return;
  const sourceText = await readFile(source, "utf8");
  let destinationText = "";

  if (agent.configFormat === "toml") {
    const header = `[${agent.configKey}.ai-game-developer]`;
    const generatedSection = tomlSection(sourceText, header, source);
    if (await exists(destination)) {
      destinationText = replaceTomlSection(
        await readFile(destination, "utf8"),
        sourceText,
        header,
        source,
      );
    } else {
      destinationText = `${generatedSection}\n`;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await atomicWriteFile(destination, destinationText);
    const remaining = removeTomlSection(sourceText, header);
    if (remaining) await atomicWriteFile(source, remaining);
    else await rm(source, { force: true });
    return;
  }

  const sourceConfig = JSON.parse(sourceText) as Record<string, unknown>;
  const sourceBody = sourceConfig[agent.configKey];
  if (
    sourceBody === null ||
    typeof sourceBody !== "object" ||
    Array.isArray(sourceBody)
  ) {
    throw new Error(
      `Generated MCP config has no ${agent.configKey} object: ${source}`,
    );
  }
  const generatedEntry = (sourceBody as Record<string, unknown>)[
    "ai-game-developer"
  ];
  if (generatedEntry === undefined) {
    throw new Error(
      `Generated MCP config has no ${agent.configKey}.ai-game-developer entry: ${source}`,
    );
  }

  const destinationConfig = (
    (await exists(destination))
      ? JSON.parse(await readFile(destination, "utf8"))
      : {}
  ) as Record<string, unknown>;
  const destinationBody = destinationConfig[agent.configKey];
  if (
    destinationBody !== undefined &&
    (destinationBody === null ||
      typeof destinationBody !== "object" ||
      Array.isArray(destinationBody))
  ) {
    throw new Error(
      `Repository MCP config has an invalid ${agent.configKey} object: ${destination}`,
    );
  }
  destinationConfig[agent.configKey] = {
    ...(destinationBody as Record<string, unknown> | undefined),
    "ai-game-developer": generatedEntry,
  };
  await mkdir(path.dirname(destination), { recursive: true });
  await atomicWriteFile(
    destination,
    `${JSON.stringify(destinationConfig, null, 2)}\n`,
  );

  delete (sourceBody as Record<string, unknown>)["ai-game-developer"];
  if (Object.keys(sourceBody as Record<string, unknown>).length === 0)
    delete sourceConfig[agent.configKey];
  if (Object.keys(sourceConfig).length === 0) await rm(source, { force: true });
  else
    await atomicWriteFile(source, `${JSON.stringify(sourceConfig, null, 2)}\n`);
}

export async function resolveMcpTarget(
  target: string,
): Promise<{ target: string; projectDir: string; repoRoot: string }> {
  const resolvedTarget = await toRealPath(target);
  await assertUnityAssetsDir(resolvedTarget);
  const projectDir = path.dirname(resolvedTarget);
  const repoRoot = await getRepoRoot(projectDir);
  if (!repoRoot)
    throw new Error(
      `Unity project is not inside a Git repository: ${projectDir}`,
    );
  return { target: resolvedTarget, projectDir, repoRoot };
}
type SkillSnapshot = Map<string, Buffer>;

async function snapshotSkillFiles(
  root: string,
  current = root,
  snapshot: SkillSnapshot = new Map(),
): Promise<SkillSnapshot> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return snapshot;
  }
  for (const entry of entries) {
    const filePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await snapshotSkillFiles(root, filePath, snapshot);
    } else if (entry.isFile()) {
      snapshot.set(path.relative(root, filePath), await readFile(filePath));
    }
  }
  return snapshot;
}

export async function relocateMcpSkills(
  projectDir: string,
  repoRoot: string,
  agentId: McpAgentId,
  before: SkillSnapshot = new Map(),
  sinceMs = 0,
): Promise<{ skillsPath: string; skillCount: number }> {
  const relativePath = PROJECT_LOCAL_SKILLS[agentId];
  const source = path.join(projectDir, relativePath);
  const destination = path.join(repoRoot, relativePath);
  const after = await snapshotSkillFiles(source);
  const skillDirs = [
    ...new Set(
      [...after.keys()]
        .filter((filePath) => path.basename(filePath) === "SKILL.md")
        .map((filePath) => filePath.split(path.sep)[0])
        .filter((dir): dir is string => dir !== undefined),
    ),
  ];
  if (skillDirs.length === 0)
    throw new McpStageError(
      "setup-skills",
      "the CLI produced no generated SKILL.md files",
    );
  if (source === destination) {
    // In-place verification: the snapshot came straight off disk.
    return { skillsPath: destination, skillCount: skillDirs.length };
  }
  // Generator-touched dirs: content differs from the pre-setup snapshot, or a
  // file was rewritten during this run. The plugin rewrites identical output
  // on every setup-skills (and auto-regenerates on Editor startup), so a
  // content-only diff would report nothing and fail the run spuriously.
  const touchedDirs = new Set<string>();
  for (const [filePath, content] of after) {
    const dir = filePath.split(path.sep)[0];
    if (dir === undefined || !skillDirs.includes(dir)) continue;
    const previous = before.get(filePath);
    let touched = previous === undefined || !previous.equals(content);
    if (!touched && sinceMs > 0)
      touched = (await stat(path.join(source, filePath))).mtimeMs >= sinceMs;
    if (touched) touchedDirs.add(dir);
  }
  let skillCount = 0;
  for (const dir of skillDirs) {
    const sourceDir = path.join(source, dir);
    const destinationDir = path.join(destination, dir);
    const files = [...after.entries()].filter(
      ([filePath]) => filePath.split(path.sep)[0] === dir,
    );
    let identical = files.length > 0;
    for (const [filePath, content] of files) {
      const installed = await readOptionalFile(path.join(destination, filePath));
      if (installed === null || !installed.equals(content)) {
        identical = false;
        break;
      }
    }
    // Untouched dirs absent from the destination are unrelated pre-existing
    // content the CLI didn't generate — preserve them where they are.
    if (!touchedDirs.has(dir) && !identical) continue;
    if (!identical) {
      // New or changed generator output — the plugin is authoritative for
      // generator-touched dirs, so replace the installed copy wholesale.
      // Stage into a sibling temp dir and swap only after verification, so a
      // failed copy never destroys the installed skill.
      await mkdir(destination, { recursive: true });
      const stagedDir = path.join(
        destination,
        "." + path.basename(destinationDir) + ".stage-" + randomUUID(),
      );
      try {
        await cp(sourceDir, stagedDir, { recursive: true });
        for (const [filePath] of files) {
          if (!(await exists(path.join(stagedDir, path.relative(dir, filePath)))))
            throw new McpStageError(
              "setup-skills",
              "skill file disappeared during relocation: " + filePath,
            );
        }
        await rm(destinationDir, { recursive: true, force: true });
        await rename(stagedDir, destinationDir);
      } catch (error) {
        await rm(stagedDir, { recursive: true, force: true });
        throw error;
      }
    }
    await rm(sourceDir, { recursive: true, force: false });
    skillCount += 1;
  }
  // Prune the emptied skills root and its now-empty ancestors (e.g.
  // <project>/.claude/skills, then .claude), never above the project itself.
  // rmdir removes only empty directories, so user content is never touched.
  for (let dir = source; dir !== projectDir; dir = path.dirname(dir)) {
    try {
      await rmdir(dir);
    } catch {
      break;
    }
  }
  return { skillsPath: destination, skillCount };
}

export async function relocateMcpArtifacts(
  projectDir: string,
  repoRoot: string,
  agentId: string,
  configSourceOverride?: string,
): Promise<{ configPath: string }> {
  const agent = agentFor(agentId);
  const configSource =
    configSourceOverride ?? path.join(projectDir, agent.configPath);
  const configDestination = path.join(repoRoot, agent.configPath);
  await mergeGeneratedConfig(configSource, configDestination, agent);
  return { configPath: configDestination };
}
async function localMcpHost(projectDir: string): Promise<string> {
  const configPath = path.join(projectDir, "UserSettings", "AI-Game-Developer-Config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const host = typeof config?.host === "string" ? new URL(config.host) : null;
  if (!host || !["http:", "https:"].includes(host.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(host.hostname) ||
      host.username || host.password) {
    throw new McpStageError("setup-mcp", `Set a local MCP host in ${configPath}`);
  }
  return host.href;
}
async function runMcpArtifactPhase(
  opts: McpLifecycleOptions,
  resolved: { target: string; projectDir: string; repoRoot: string },
  agent: (typeof PROJECT_LOCAL_AGENTS)[number],
  lifecycleOpts: McpLifecycleOptions,
  doneDetail: string,
): Promise<void> {
  const configureArgs = [
    "configure",
    opts.enableAllTools === false
      ? "--disable-all-tools"
      : "--enable-all-tools",
    opts.enableAllPrompts === false
      ? "--disable-all-prompts"
      : "--enable-all-prompts",
    opts.enableAllResources === false
      ? "--disable-all-resources"
      : "--enable-all-resources",
    resolved.projectDir,
  ];
  const configSource = path.join(resolved.projectDir, agent.configPath);
  const configBefore = await readOptionalFile(configSource);
  const configDestination = path.join(resolved.repoRoot, agent.configPath);
  const configStage = path.join(
    resolved.repoRoot,
    ".scvn-mcp-config-" + randomUUID() + ".tmp",
  );
  let configMerged = false;
  const skillsBefore =
    opts.verb === "skills"
      ? await snapshotSkillFiles(
          path.join(resolved.projectDir, PROJECT_LOCAL_SKILLS[agent.value]),
        )
      : new Map<string, Buffer>();
  let skillsSince = 0;

  try {
    if (opts.verb !== "skills")
      await command(lifecycleOpts, "configure", configureArgs, resolved.projectDir);
    await command(
      lifecycleOpts,
      "setup-mcp",
      ["setup-mcp", agent.value, resolved.projectDir, "--url", opts.dryRun
        ? "<local host from UserSettings/AI-Game-Developer-Config.json>"
        : await localMcpHost(resolved.projectDir)],
      resolved.projectDir,
    );
    if (!opts.dryRun) {
      const generatedConfig = await readOptionalFile(configSource);
      if (generatedConfig === null)
        throw new McpStageError("setup-mcp", "the CLI produced no agent config");
      await restoreFile(configSource, configBefore);
      await writeFile(configStage, generatedConfig);
      await relocateMcpArtifacts(
        resolved.projectDir,
        resolved.repoRoot,
        agent.value,
        configStage,
      );
      configMerged = true;
    }
    if (opts.verb === "skills") {
      skillsSince = Date.now();
      await command(
        lifecycleOpts,
        "setup-skills",
        ["setup-skills", agent.value, resolved.projectDir],
        resolved.projectDir,
      );
    }
    if (opts.dryRun) {
      opts.reporter?.onStatus({ status: "done", detail: doneDetail });
      return;
    }
  } finally {
    if (!configMerged || configSource !== configDestination)
      await restoreFile(configSource, configBefore);
    await rm(configStage, { force: true });
  }

  if (opts.verb === "skills") {
    const skills = await relocateMcpSkills(
      resolved.projectDir,
      resolved.repoRoot,
      agent.value,
      skillsBefore,
      skillsSince,
    );
    report(
      opts,
      "skills installed at " +
        skills.skillsPath +
        " (" +
        skills.skillCount +
        " skill directories)",
    );
  }
  opts.reporter?.onStatus({ status: "done", detail: doneDetail });
}

export async function runMcpLifecycle(
  opts: McpLifecycleOptions,
): Promise<{ projectDir: string; repoRoot: string }> {
  const resolved = await resolveMcpTarget(opts.target);
  const agent = agentFor(opts.agent ?? "claude-code");
  const addons =
    opts.extensions === undefined ? undefined : extensionIds(opts.extensions);
  let sessionCliDir: string | null = null;
  const lifecycleOpts = opts.run
    ? opts
    : {
        ...opts,
        run: async (args: readonly string[], cwd: string) =>
          sessionCliDir === null
            ? cachedRun(args, cwd)
            : runCachedCli(sessionCliDir, args, cwd),
      };

  const common = {
    target: resolved.target,
    cacheDir: writeCacheDir(),
    dryRun: opts.dryRun,
    force: opts.force,
    purgeNuget: opts.purgeNuget,
    reporter: opts.reporter,
    agent: agent.value,
  };
  if (opts.verb === "finish") {
    // Dynamic import: upstream-status.ts statically imports this module, so a
    // static reverse import here would be a module cycle.
    const { readUpstreamProjectState } = await import("./upstream-status.js");
    const state = await readUpstreamProjectState(resolved.target);
    if (!state.installed)
      throw new Error("Unity-MCP is not installed on this project — run install first");
    // The plugin reads AI-Game-Developer-Config.json only at Editor init (no file
    // watcher), so capability flags must land BEFORE `open`; a running Editor
    // applies file edits on its next launch only.
    const running = await detectUnityRunning(resolved.projectDir);
    const configureArgs = [
      "configure",
      opts.enableAllTools === false ? "--disable-all-tools" : "--enable-all-tools",
      opts.enableAllPrompts === false ? "--disable-all-prompts" : "--enable-all-prompts",
      opts.enableAllResources === false ? "--disable-all-resources" : "--enable-all-resources",
      resolved.projectDir,
    ];
    const flagsDiffer =
      state.enableAllTools !== (opts.enableAllTools ?? true) ||
      state.enableAllPrompts !== (opts.enableAllPrompts ?? true) ||
      state.enableAllResources !== (opts.enableAllResources ?? true);
    if (running) {
      if (flagsDiffer)
        throw new Error(
          "Unity is open with different capability flags — close it (or revert the toggles) and rerun: " +
            "the plugin loads capability flags only at Editor startup, so generating skills now would " +
            "reflect its stale registered tool set",
        );
      report(opts, "Unity already open — skipping project launch");
    } else {
      await command(lifecycleOpts, "configure", configureArgs, resolved.projectDir);
      await command(lifecycleOpts, "open", ["open", resolved.projectDir], resolved.projectDir);
    }
    await command(
      lifecycleOpts,
      "wait-for-ready",
      ["wait-for-ready", "--timeout", String(opts.waitTimeoutMs ?? 600000), resolved.projectDir],
      resolved.projectDir,
    );
  }

  if (opts.verb === "skills" || opts.verb === "finish") {
    if (!opts.run && !opts.dryRun)
      sessionCliDir = await resolveCurrentSessionCli(resolved.projectDir);
    await runMcpArtifactPhase(
      opts.verb === "finish" ? { ...opts, verb: "skills" } : opts,
      resolved,
      agent,
      lifecycleOpts,
      "MCP skills ready for " + agent.label,
    );
    return resolved;
  }

  if (opts.verb === "uninstall") {
    await uninstallMcp(common);
    report(opts, "local MCP packages removed");
    return resolved;
  }
  if (opts.verb === "update") {
    await updateMcp({ ...common, coreVersion: opts.pluginVersion });
  } else if (opts.verb === "reconfigure") {
    await reconfigureMcp({
      ...common,
      addons,
      coreVersion: opts.pluginVersion,
    });
  } else {
    await installMcp({
      ...common,
      addons,
      coreVersion: opts.pluginVersion,
      addonsRequired: opts.addonsRequired,
    });
  }
  if (!opts.run && !opts.dryRun)
    sessionCliDir = await resolveCurrentSessionCli(resolved.projectDir);

  await runMcpArtifactPhase(
    opts,
    resolved,
    agent,
    lifecycleOpts,
    "MCP ready for " + agent.label,
  );
  return resolved;
}

export async function removeMcpPlugin(
  opts: Pick<
    McpLifecycleOptions,
    "target" | "dryRun" | "purgeNuget" | "reporter"
  >,
): Promise<void> {
  await uninstallMcp({
    target: opts.target,
    dryRun: opts.dryRun,
    purgeNuget: opts.purgeNuget,
    reporter: opts.reporter,
  });
}
