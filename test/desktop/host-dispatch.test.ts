/**
 * test/desktop/host-dispatch.test.ts — Host-side integration for the desktop app.
 *
 * The GUI cannot be clicked headlessly, so these tests drive the real host
 * dispatcher + GUI adapters through a fake channel to prove Phase 3 behavior:
 *   - invoke routes to a handler and streams output/progress then a result
 *   - an unknown command surfaces a typed error
 *   - cancelling an in-flight prompt unwinds as PromptCancelled (host survives)
 *   - the GUI PromptAdapter produces on-disk results identical to the CLI's
 *     fakePrompt (parity), since only the adapter differs, not the handler.
 *
 * Completion is awaited via the terminal (result|error) message the fake
 * channel observes — no wall-clock timers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { createHost, type CommandRegistry, type HostApi } from "../../desktop/host/dispatcher.js";
import { HostSession } from "../../desktop/host/session.js";
import { createGuiPrompt } from "../../desktop/host/gui-prompt.js";
import { createGuiOutput } from "../../desktop/host/gui-output.js";
import type { FromHost, PromptValue } from "../../desktop/shared/ipc.js";
import { runConfig } from "../../src/commands/config.js";
import { fakePrompt } from "../../src/ui/prompt.js";
import { registry } from "../../desktop/host/registry.js";
import { CHECKS } from "../../src/doctor/checks.js";
import { capabilities } from "../../desktop/host/capabilities.js";

// ---------------------------------------------------------------------------
// Fake channel
// ---------------------------------------------------------------------------

interface DrivenHost {
  host: HostApi;
  sent: FromHost[];
  /** Resolves with the terminal result|error message. */
  done: Promise<FromHost>;
  /** Resolves the first time the host asks a prompt. */
  prompted: Promise<void>;
}

/**
 * Build a host over a fake channel. When `autoRespond` is true (default),
 * prompt-requests are answered from `answers` (null once the queue drains);
 * when false, prompts stay open so a test can drive `cancel` explicitly.
 */
function driveHost(
  registry: CommandRegistry,
  opts: { answers?: Array<PromptValue | null>; autoRespond?: boolean } = {},
): DrivenHost {
  const { answers = [], autoRespond = true } = opts;
  const queue = [...answers];
  const sent: FromHost[] = [];
  const done = Promise.withResolvers<FromHost>();
  const prompted = Promise.withResolvers<void>();

  const host = createHost((message) => {
    sent.push(message);
    if (message.kind === "prompt-request") {
      prompted.resolve();
      if (autoRespond) {
        const value = queue.length > 0 ? queue.shift()! : null;
        queueMicrotask(() =>
          host.handle({ kind: "prompt-response", requestId: message.requestId, promptId: message.promptId, value }),
        );
      }
    }
    if (message.kind === "result" || message.kind === "error") done.resolve(message);
  }, registry);

  return { host, sent, done: done.promise, prompted: prompted.promise };
}

/** A session whose prompt-requests are auto-answered from a scripted queue. */
function scriptedSession(requestId: string, answers: Array<PromptValue | null>): { session: HostSession; sent: FromHost[] } {
  const sent: FromHost[] = [];
  const queue = [...answers];
  const session = new HostSession(requestId, (message) => {
    sent.push(message);
    if (message.kind === "prompt-request") {
      const value = queue.length > 0 ? queue.shift()! : null;
      queueMicrotask(() => session.resolvePrompt(message.promptId, value));
    }
  });
  return { session, sent };
}

// ---------------------------------------------------------------------------
// Suppress stdout/stderr from any real handler under test.
// ---------------------------------------------------------------------------

let stdoutWrite: typeof process.stdout.write;
let stderrWrite: typeof process.stderr.write;

beforeEach(() => {
  stdoutWrite = process.stdout.write.bind(process.stdout);
  stderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  process.exitCode = undefined;
});

afterEach(() => {
  process.stdout.write = stdoutWrite;
  process.stderr.write = stderrWrite;
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe("createHost() dispatcher", () => {
  it("streams output + progress then a result for a handler", async () => {
    const registry: CommandRegistry = {
      async demo(session) {
        session.emitOutput({ level: "intro", message: "hi" });
        session.emitProgress({ phase: "start", message: "go" });
        return { ok: true };
      },
    };
    const { host, sent, done } = driveHost(registry);
    host.handle({ kind: "invoke", requestId: "r1", command: "demo" });

    const terminal = await done;
    expect(terminal).toEqual({ kind: "result", requestId: "r1", value: { ok: true } });
    expect(sent.map((m) => m.kind)).toEqual(["output-event", "progress-event", "result"]);
  });

  it("emits a typed error for an unknown command", async () => {
    const { host, done } = driveHost({});
    host.handle({ kind: "invoke", requestId: "r2", command: "nope" });

    const terminal = await done;
    expect(terminal.kind).toBe("error");
    if (terminal.kind === "error") expect(terminal.name).toBe("UnknownCommand");
  });

  it("unwinds an in-flight prompt as PromptCancelled on cancel (host survives)", async () => {
    const registry: CommandRegistry = {
      async asks(session) {
        const prompt = createGuiPrompt(session);
        return prompt.select({ message: "pick", options: [{ value: "a", label: "A" }] });
      },
    };
    const { host, done, prompted } = driveHost(registry, { autoRespond: false });
    host.handle({ kind: "invoke", requestId: "r3", command: "asks" });

    await prompted; // the handler is now blocked on the prompt
    host.handle({ kind: "cancel", requestId: "r3" });

    const terminal = await done;
    expect(terminal.kind).toBe("error");
    if (terminal.kind === "error") expect(terminal.name).toBe("PromptCancelled");
  });
});

// ---------------------------------------------------------------------------
// GUI adapter parity
// ---------------------------------------------------------------------------

describe("GUI adapter parity with the CLI", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "scvn-host-parity-"));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("runConfig via the GUI prompt writes the same config file as via fakePrompt", async () => {
    const isDir = async (p: string): Promise<boolean> => p === "/valid/projects";

    const cliPath = path.join(tmp, "cli-config");
    await runConfig({ prompt: fakePrompt(["/valid/projects"]), isDir, configPath: cliPath, isTTY: true });

    const { session } = scriptedSession("g1", ["/valid/projects"]);
    const guiPath = path.join(tmp, "gui-config");
    await runConfig({
      prompt: createGuiPrompt(session),
      output: createGuiOutput(session),
      isDir,
      configPath: guiPath,
      isTTY: true,
    });

    const cli = await readFile(cliPath, "utf8");
    const gui = await readFile(guiPath, "utf8");
    expect(gui).toBe(cli);
    expect(gui).toContain("SCVN_PROJECTS_ROOT=/valid/projects");
  });

  it("re-prompts with dir intent until an existing directory is chosen, like the CLI", async () => {
    const isDir = async (p: string): Promise<boolean> => p === "/good/root";
    const { session, sent } = scriptedSession("g2", ["/does/not/exist", "/good/root"]);
    const guiPath = path.join(tmp, "gui-config-2");

    await runConfig({
      prompt: createGuiPrompt(session),
      output: createGuiOutput(session),
      isDir,
      configPath: guiPath,
      isTTY: true,
    });

    const textPrompts = sent.filter((m) => m.kind === "prompt-request" && m.prompt.type === "text");
    expect(textPrompts).toHaveLength(2);
    const first = textPrompts[0];
    if (first?.kind === "prompt-request" && first.prompt.type === "text") {
      expect(first.prompt.kind).toBe("dir");
    }
    expect(await readFile(guiPath, "utf8")).toContain("SCVN_PROJECTS_ROOT=/good/root");
  });
});

// ---------------------------------------------------------------------------
// Registry wiring (Phase 4 form routes)
// ---------------------------------------------------------------------------

describe("registry exposes form prepare/execute routes", () => {
  it("registers a prepare + execute route for each form capability", () => {
    for (const id of ["fork", "config"]) {
      expect(typeof registry[id]).toBe("function");
      expect(typeof registry[`${id}:prepare`]).toBe("function");
    }
  });

  it("keeps the command (non-form) capabilities, projects:discover, and ping", () => {
    for (const id of ["git", "packages", "doctor", "ping", "mcp"]) {
      expect(typeof registry[id]).toBe("function");
      expect(registry[`${id}:prepare`]).toBeUndefined();
    }
    expect(typeof registry["projects:discover"]).toBe("function");
    expect(typeof registry["mcp:project-status"]).toBe("function");
  });

  it("exposes ignore-dirty as request/response list + set routes, not a run command", () => {
    expect(typeof registry["ignore-dirty:list"]).toBe("function");
    expect(typeof registry["ignore-dirty:set"]).toBe("function");
    // The old prompt-channel run command is gone (page view replaced it).
    expect(registry["ignore-dirty"]).toBeUndefined();
  });

  it("registers every capability command regardless of SCVN_TABS (reveal invariant)", () => {
    // Tab hiding is renderer visibility-only: the host must serve every
    // capability command so a ⌘⇧.-revealed tab is genuinely invokable. If
    // host-side filtering is ever reintroduced, this fails loudly.
    expect(Object.keys(registry).sort()).toEqual(["ping", ...Object.keys(capabilities)].sort());
  });
});

// ---------------------------------------------------------------------------
// Onboarding status routes (config:status / doctor:report)
// ---------------------------------------------------------------------------
const ROOT_ENV = "SCVN_PROJECTS_ROOT";
let prevRootEnv: string | undefined;

describe("onboarding status routes", () => {
  beforeEach(() => {
    prevRootEnv = process.env[ROOT_ENV];
  });

  afterEach(() => {
    if (prevRootEnv === undefined) delete process.env[ROOT_ENV];
    else process.env[ROOT_ENV] = prevRootEnv;
  });

  it("registers the status routes on the registry", () => {
    expect(typeof registry["config:status"]).toBe("function");
    expect(typeof registry["doctor:report"]).toBe("function");
  });

  it("config:status reports an env-resolved existing root as ready", async () => {
    // Env always wins over the (machine-local) config file, so pinning it
    // makes the test deterministic without touching ~/.scvn/config.
    const dir = await mkdtemp(path.join(os.tmpdir(), "scvn-status-"));
    process.env[ROOT_ENV] = dir;
    const { host, done } = driveHost(registry);
    host.handle({ kind: "invoke", requestId: "s1", command: "config:status" });

    const terminal = await done;
    expect(terminal).toEqual({
      kind: "result",
      requestId: "s1",
      value: { projectsRoot: dir, ready: true, source: "env" },
    });
  });

  it("config:status flags a missing env root as not ready (the CLI-guard predicate)", async () => {
    process.env[ROOT_ENV] = "/definitely/not/a/real/scvn/dir";
    const { host, done } = driveHost(registry);
    host.handle({ kind: "invoke", requestId: "s2", command: "config:status" });

    const terminal = await done;
    expect(terminal).toEqual({
      kind: "result",
      requestId: "s2",
      value: { projectsRoot: "/definitely/not/a/real/scvn/dir", ready: false, source: "env" },
    });
  });

  it("doctor:report returns one structured row per registered check", async () => {
    const { host, done } = driveHost(registry);
    host.handle({ kind: "invoke", requestId: "d1", command: "doctor:report" });

    const terminal = await done;
    expect(terminal.kind).toBe("result");
    if (terminal.kind !== "result") return;
    const value = terminal.value as { reports: { id: string; severity: string }[]; exitCode: number };
    expect(value.reports.map((r) => r.id).sort()).toEqual([...CHECKS].map((c) => c.id).sort());
    expect([0, 1]).toContain(value.exitCode);
    for (const report of value.reports) {
      expect(["pass", "warn", "fail", "skipped"]).toContain(report.severity);
    }
  });
});
