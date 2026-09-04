import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const statusMocks = vi.hoisted(() => ({
  getMcpStatus: vi.fn(),
  renderMcpStatus: vi.fn(() => ["staged versions: V1.0.0"]),
}));
const discoveryMocks = vi.hoisted(() => ({
  getProjectsRoot: vi.fn(async () => "/projects"),
}));
const targetMocks = vi.hoisted(() => ({
  selectSetupTarget: vi.fn(async () => "/picked/Assets"),
}));
const addonMocks = vi.hoisted(() => ({
  selectMcpAddons: vi.fn(async () => ["animation"]),
}));
const upstreamMocks = vi.hoisted(() => ({
  PROJECT_LOCAL_AGENTS: [{ value: "claude-code", label: "Claude Code", configPath: ".mcp.json", configFormat: "json", configKey: "mcpServers" }],
  runMcpLifecycle: vi.fn(async () => ({ projectDir: "/p", repoRoot: "/repo" })),
  removeMcpPlugin: vi.fn(async () => {}),
}));

vi.mock("../../src/features/mcp/status-mcp.js", () => statusMocks);
vi.mock("../../src/commands/shared/project-discovery.js", () => discoveryMocks);
vi.mock("../../src/commands/shared/select-setup-target.js", () => targetMocks);
vi.mock("../../src/commands/shared/select-mcp-addons.js", () => addonMocks);
vi.mock("../../src/features/mcp/upstream.js", () => upstreamMocks);

import { runMcp, MCP_USAGE_HINT } from "../../src/commands/mcp.js";
import type { PromptAdapter } from "../../src/ui/prompt.js";

const fakePrompt = {
  select: vi.fn(),
  multiselect: vi.fn(),
  confirm: vi.fn(async () => true),
  text: vi.fn(),
  spinner: () => ({ start() {}, stop() {}, message() {} }),
} as unknown as PromptAdapter;

let errors: string[];
let outputs: string[];

beforeEach(() => {
  vi.clearAllMocks();
  errors = [];
  outputs = [];
  vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); });
  vi.spyOn(console, "log").mockImplementation((...a) => { outputs.push(a.join(" ")); });
  statusMocks.getMcpStatus.mockResolvedValue({ versions: [], projects: [] });
  targetMocks.selectSetupTarget.mockResolvedValue("/picked/Assets");
  addonMocks.selectMcpAddons.mockResolvedValue(["animation"]);
  delete process.env["SCVN_TARGET"];
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("bare mcp", () => {
  it("prints usage and exits 1", async () => {
    await runMcp({}, fakePrompt);
    expect(errors.join("\n")).toContain(MCP_USAGE_HINT);
    expect(process.exitCode).toBe(1);
    expect(upstreamMocks.runMcpLifecycle).not.toHaveBeenCalled();
  });
});

describe("mcp status", () => {
  it("renders offline status through the projects root", async () => {
    await runMcp({ verb: "status" }, fakePrompt);
    expect(statusMocks.getMcpStatus).toHaveBeenCalledWith(expect.objectContaining({ projectsRoot: "/projects" }));
    expect(outputs.join("\n")).toContain("V1.0.0");
  });
});

describe("mcp lifecycle dispatch", () => {
  it("passes target, selected extensions, agent, capability flags, and force", async () => {
    await runMcp({
      verb: "install", target: "/p/Assets", addons: "animation,particlesystem", agent: "claude-code",
      enableAllTools: false, enableAllPrompts: true, enableAllResources: false, force: true, autoYes: true,
    }, fakePrompt);
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      target: "/p/Assets",
      extensions: ["animation", "particlesystem"],
      agent: "claude-code",
      enableAllTools: false,
      enableAllPrompts: true,
      enableAllResources: false,
      force: true,
    }));
  });
  it("passes an explicit empty extension selection", async () => {
    await runMcp({ verb: "install", target: "/p/Assets", addons: "", autoYes: true }, fakePrompt);
    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({ extensions: [] }));
  });
  it("uses the interactive target and extension picker when not automated", async () => {
    await runMcp({ verb: "install" }, fakePrompt);
    expect(targetMocks.selectSetupTarget).toHaveBeenCalled();
    expect(addonMocks.selectMcpAddons).toHaveBeenCalled();
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      target: "/picked/Assets", extensions: ["animation"],
    }));
  });

  it("does not guess a target under --yes", async () => {
    await runMcp({ verb: "install", autoYes: true }, fakePrompt);
    expect(process.exitCode).toBe(1);
    expect(upstreamMocks.runMcpLifecycle).not.toHaveBeenCalled();
  });

  it("uses the configured target under --yes", async () => {
    process.env["SCVN_TARGET"] = "/env/Assets";
    await runMcp({ verb: "install", autoYes: true }, fakePrompt);
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({ target: "/env/Assets", extensions: undefined }));
  });

  it("dispatches update and positional version without opening the picker", async () => {
    await runMcp({ verb: "update", version: "0.82.3", target: "/p/Assets", autoYes: true }, fakePrompt);
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({ verb: "update", pluginVersion: "0.82.3" }));
    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
  });
  it("dispatches skills resume without package mutation", async () => {
    await runMcp({ verb: "skills", target: "/p/Assets", agent: "claude-code", autoYes: true }, fakePrompt);
    expect(upstreamMocks.runMcpLifecycle).toHaveBeenCalledWith(expect.objectContaining({ verb: "skills", target: "/p/Assets", agent: "claude-code" }));
    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
  });

  it("dispatches uninstall to the local package owner", async () => {
    await runMcp({ verb: "uninstall", target: "/p/Assets", purgeNuget: true, autoYes: true }, fakePrompt);
    expect(upstreamMocks.removeMcpPlugin).toHaveBeenCalledWith(expect.objectContaining({ target: "/p/Assets", purgeNuget: true }));
  });
});
