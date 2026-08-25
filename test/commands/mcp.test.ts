/**
 * test/commands/mcp.test.ts — `scvn mcp` dispatch.
 *
 * Bare `scvn mcp` follows the `scvn git` precedent — usage hint on stderr, exit 1
 * — rather than the `scvn packages` verb menu. There is no safe default verb.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const statusMocks = vi.hoisted(() => ({
  getMcpStatus: vi.fn(),
  renderMcpStatus: vi.fn(() => ["staged versions:  V1.0.0"]),
}));
const discoveryMocks = vi.hoisted(() => ({
  getProjectsRoot: vi.fn(async () => "/projects"),
  projectsToOptions: vi.fn(() => []),
  resolveProjectsRoot: vi.fn(async () => "/projects"),
  MISSING_PROJECTS_ROOT_MESSAGE: "missing root",
}));
const featureMocks = vi.hoisted(() => ({
  installMcp: vi.fn(async () => {}),
  uninstallMcp: vi.fn(async () => {}),
  updateMcp: vi.fn(async () => {}),
}));
const targetMocks = vi.hoisted(() => ({
  selectSetupTarget: vi.fn(async () => "/picked/Assets"),
}));
const addonMocks = vi.hoisted(() => ({
  selectMcpAddons: vi.fn(async () => ["com.ivanmurzak.unity.mcp.animation"]),
  addonLabel: vi.fn((p: string) => p),
}));

vi.mock("../../src/features/mcp/status-mcp.js", () => statusMocks);
vi.mock("../../src/commands/shared/project-discovery.js", () => discoveryMocks);
vi.mock("../../src/features/mcp/install-mcp.js", () => ({ installMcp: featureMocks.installMcp }));
vi.mock("../../src/features/mcp/uninstall-mcp.js", () => ({ uninstallMcp: featureMocks.uninstallMcp }));
vi.mock("../../src/features/mcp/update-mcp.js", () => ({ updateMcp: featureMocks.updateMcp }));
vi.mock("../../src/commands/shared/select-setup-target.js", () => targetMocks);
vi.mock("../../src/commands/shared/select-mcp-addons.js", () => addonMocks);

import { runMcp, MCP_USAGE_HINT } from "../../src/commands/mcp.js";
import type { PromptAdapter } from "../../src/ui/prompt.js";

/** A prompt that never blocks — every flow here is asserted, not driven. */
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
  statusMocks.renderMcpStatus.mockReturnValue(["staged versions:  V1.0.0"]);
  discoveryMocks.getProjectsRoot.mockResolvedValue("/projects");
  targetMocks.selectSetupTarget.mockResolvedValue("/picked/Assets");
  addonMocks.selectMcpAddons.mockResolvedValue(["com.ivanmurzak.unity.mcp.animation"]);
  delete process.env["SCVN_TARGET"];
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("bare `scvn mcp`", () => {
  it("prints the usage hint and exits 1 — no menu, no default verb", async () => {
    await runMcp({}, fakePrompt);

    expect(errors.join("\n")).toContain(MCP_USAGE_HINT);
    expect(process.exitCode).toBe(1);
    expect(featureMocks.installMcp).not.toHaveBeenCalled();
  });

  it("names the offending token on an unknown verb", async () => {
    await runMcp({ verb: "instal" }, fakePrompt);

    expect(errors.join("\n")).toContain("instal");
    expect(process.exitCode).toBe(1);
  });
});

describe("`scvn mcp status`", () => {
  it("renders the offline status through the projects root", async () => {
    await runMcp({ verb: "status" }, fakePrompt);

    expect(statusMocks.getMcpStatus).toHaveBeenCalledWith(
      expect.objectContaining({ projectsRoot: "/projects" }),
    );
    expect(outputs.join("\n")).toContain("V1.0.0");
    expect(process.exitCode).toBeUndefined();
  });
});

describe("`scvn mcp install`", () => {
  it("requires an explicit target under -y", async () => {
    await runMcp({ verb: "install", autoYes: true }, fakePrompt);

    expect(process.exitCode).toBe(1);
    expect(featureMocks.installMcp).not.toHaveBeenCalled();
    expect(targetMocks.selectSetupTarget).not.toHaveBeenCalled();
  });

  it("threads an explicit --target and the addon CSV", async () => {
    await runMcp(
      { verb: "install", target: "/p/Assets", addons: "animation", autoYes: true },
      fakePrompt,
    );

    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "/p/Assets",
        addons: ["com.ivanmurzak.unity.mcp.animation"],
      }),
    );
  });

  it("threads a cinemachine addon through like any other", async () => {
    await runMcp(
      { verb: "install", target: "/p/Assets", addons: "cinemachine", autoYes: true },
      fakePrompt,
    );

    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({
        addons: ["com.ivanmurzak.unity.mcp.cinemachine"],
      }),
    );
  });

  it("opens the addon picker interactively when --addons is absent", async () => {
    await runMcp({ verb: "install", target: "/p/Assets" }, fakePrompt);

    expect(addonMocks.selectMcpAddons).toHaveBeenCalled();
    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ addons: ["com.ivanmurzak.unity.mcp.animation"] }),
    );
  });

  it("leaves the addon set UNRESOLVED under -y instead of opening a menu", async () => {
    // Materializing the default seed here would look like a typed --addons and
    // force a fetch — on a bundled/offline machine that is exactly wrong. Let
    // install decide: adopt what is staged, or fetch the seed when nothing is.
    await runMcp({ verb: "install", target: "/p/Assets", autoYes: true }, fakePrompt);

    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ addons: undefined, addonsRequired: false }),
    );
  });

  it("marks a TYPED --addons as required, and a picker choice as a preference", async () => {
    await runMcp(
      { verb: "install", target: "/p/Assets", addons: "animation", autoYes: true },
      fakePrompt,
    );
    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ addonsRequired: true }),
    );

    vi.clearAllMocks();
    await runMcp({ verb: "install", target: "/p/Assets" }, fakePrompt);
    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ addonsRequired: false }),
    );
  });

  it("falls back to the interactive picker when no target is given", async () => {
    await runMcp({ verb: "install" }, fakePrompt);

    expect(targetMocks.selectSetupTarget).toHaveBeenCalled();
    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ target: "/picked/Assets" }),
    );
  });

  it("honours SCVN_TARGET", async () => {
    process.env["SCVN_TARGET"] = "/env/Assets";

    await runMcp({ verb: "install", autoYes: true }, fakePrompt);

    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ target: "/env/Assets" }),
    );
  });

  it("threads --force and -n", async () => {
    await runMcp(
      { verb: "install", target: "/p/Assets", force: true, dryRun: true, autoYes: true },
      fakePrompt,
    );

    expect(featureMocks.installMcp).toHaveBeenCalledWith(
      expect.objectContaining({ force: true, dryRun: true }),
    );
  });

  it("exits 1 when the install throws", async () => {
    featureMocks.installMcp.mockRejectedValueOnce(new Error("pin gate FAILED"));

    await runMcp({ verb: "install", target: "/p/Assets", autoYes: true }, fakePrompt);

    expect(process.exitCode).toBe(1);
  });
});

describe("`scvn mcp update`", () => {
  it("threads the positional <coreVer> — the rollback form", async () => {
    await runMcp(
      { verb: "update", version: "0.82.3", target: "/p/Assets", autoYes: true },
      fakePrompt,
    );

    expect(featureMocks.updateMcp).toHaveBeenCalledWith(
      expect.objectContaining({ target: "/p/Assets", coreVersion: "0.82.3" }),
    );
    expect(featureMocks.installMcp).not.toHaveBeenCalled();
  });

  it("passes no version for a bare update (registry latest)", async () => {
    await runMcp({ verb: "update", target: "/p/Assets", autoYes: true }, fakePrompt);

    expect(featureMocks.updateMcp).toHaveBeenCalledWith(
      expect.objectContaining({ coreVersion: undefined }),
    );
  });

  it("requires an explicit target under -y", async () => {
    await runMcp({ verb: "update", autoYes: true }, fakePrompt);

    expect(process.exitCode).toBe(1);
    expect(featureMocks.updateMcp).not.toHaveBeenCalled();
  });

  it("never opens the addon picker — the marker is the lockfile", async () => {
    await runMcp({ verb: "update", target: "/p/Assets" }, fakePrompt);

    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
  });

  it("exits 1 when update refuses (unattached project, offline bump)", async () => {
    featureMocks.updateMcp.mockRejectedValueOnce(new Error("does not have MCP installed"));

    await runMcp({ verb: "update", target: "/p/Assets", autoYes: true }, fakePrompt);

    expect(process.exitCode).toBe(1);
  });
});

describe("`scvn mcp uninstall`", () => {
  it("threads --purge-nuget", async () => {
    await runMcp(
      { verb: "uninstall", target: "/p/Assets", purgeNuget: true, autoYes: true },
      fakePrompt,
    );

    expect(featureMocks.uninstallMcp).toHaveBeenCalledWith(
      expect.objectContaining({ target: "/p/Assets", purgeNuget: true }),
    );
  });

  it("defaults --purge-nuget to false — the DLLs are not ours to remove", async () => {
    await runMcp({ verb: "uninstall", target: "/p/Assets", autoYes: true }, fakePrompt);

    expect(featureMocks.uninstallMcp).toHaveBeenCalledWith(
      expect.objectContaining({ purgeNuget: false }),
    );
  });

  it("never opens the addon picker", async () => {
    await runMcp({ verb: "uninstall", target: "/p/Assets" }, fakePrompt);

    expect(addonMocks.selectMcpAddons).not.toHaveBeenCalled();
  });
});
