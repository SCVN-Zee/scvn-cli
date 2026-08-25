/**
 * test/util/cli-args.test.ts — Unit tests for the scvn argv parser.
 *
 * Covers namespace extraction, subcommand parsing, flags, and edge cases.
 */

import { describe, it, expect } from "vitest";
import { parseArgv } from "../../src/util/cli-args.js";

describe("parseArgv — flags", () => {
  it("parses -n as dryRun", () => {
    expect(parseArgv(["-n"]).dryRun).toBe(true);
  });

  it("parses --dry-run as dryRun", () => {
    expect(parseArgv(["--dry-run"]).dryRun).toBe(true);
  });

  it("parses -y as autoYes", () => {
    expect(parseArgv(["-y"]).autoYes).toBe(true);
  });

  it("parses --yes as autoYes", () => {
    expect(parseArgv(["--yes"]).autoYes).toBe(true);
  });

  it("parses -h as help", () => {
    expect(parseArgv(["-h"]).help).toBe(true);
  });

  it("parses --help as help", () => {
    expect(parseArgv(["--help"]).help).toBe(true);
  });

  it("parses --version as version", () => {
    expect(parseArgv(["--version"]).version).toBe(true);
  });

  it("silently ignores unknown flags", () => {
    const r = parseArgv(["--unknown-flag", "sync"]);
    expect(r.namespace).toBe("sync");
    expect(r.dryRun).toBe(false);
  });
});

describe("parseArgv — git op flags", () => {
  it("defaults ignore/exclude/lfs to false", () => {
    const r = parseArgv(["git"]);
    expect(r.ignore).toBe(false);
    expect(r.exclude).toBe(false);
    expect(r.lfs).toBe(false);
    expect(r.subcommands).toEqual(["git"]); // git is not a namespace
  });

  it("parses --ignore / --exclude / --lfs", () => {
    const r = parseArgv(["git", "--ignore", "--exclude", "--lfs"]);
    expect(r.ignore).toBe(true);
    expect(r.exclude).toBe(true);
    expect(r.lfs).toBe(true);
  });

  it("combines op flags with --target and -y", () => {
    const r = parseArgv(["git", "--lfs", "--target", "/p/Assets", "-y"]);
    expect(r.lfs).toBe(true);
    expect(r.target).toBe("/p/Assets");
    expect(r.autoYes).toBe(true);
  });
});

describe("parseArgv — namespace extraction", () => {
  it("extracts 'sync' as namespace", () => {
    const r = parseArgv(["sync"]);
    expect(r.namespace).toBe("sync");
    expect(r.subcommands).toEqual([]);
  });

  it("extracts 'sync' and rest as subcommands", () => {
    const r = parseArgv(["sync", "toolkit", "packages"]);
    expect(r.namespace).toBe("sync");
    expect(r.subcommands).toEqual(["toolkit", "packages"]);
  });

  it("'fork-setup' is no longer a known namespace — falls to subcommands", () => {
    const r = parseArgv(["fork-setup"]);
    expect(r.namespace).toBeNull();
    expect(r.subcommands).toEqual(["fork-setup"]);
  });

  it("extracts 'config' as namespace", () => {
    const r = parseArgv(["config"]);
    expect(r.namespace).toBe("config");
  });

  it("extracts 'doctor' as namespace", () => {
    const r = parseArgv(["doctor"]);
    expect(r.namespace).toBe("doctor");
  });

  it("unknown first positional sets namespace=null and goes to subcommands", () => {
    const r = parseArgv(["unknown-cmd", "foo"]);
    expect(r.namespace).toBeNull();
    expect(r.subcommands).toEqual(["unknown-cmd", "foo"]);
  });

  it("flags before namespace still parse correctly", () => {
    const r = parseArgv(["-n", "sync", "toolkit", "-y"]);
    expect(r.dryRun).toBe(true);
    expect(r.autoYes).toBe(true);
    expect(r.namespace).toBe("sync");
    expect(r.subcommands).toEqual(["toolkit"]);
  });

  it("empty argv returns all defaults", () => {
    const r = parseArgv([]);
    expect(r).toEqual({
      help: false,
      version: false,
      dryRun: false,
      autoYes: false,
      ignore: false,
      exclude: false,
      lfs: false,
      force: false,
      purgeNuget: false,
      namespace: null,
      subcommands: [],
      from: undefined,
      to: [],
      warnings: [],
    });
  });

  it("sync with multiple subcommands preserves order", () => {
    const r = parseArgv(["sync", "gitignore", "lfs", "gitexclude"]);
    expect(r.namespace).toBe("sync");
    expect(r.subcommands).toEqual(["gitignore", "lfs", "gitexclude"]);
  });
});

describe("parseArgv — setup namespace", () => {
  it("extracts 'setup' as namespace", () => {
    const r = parseArgv(["setup"]);
    expect(r.namespace).toBe("setup");
    expect(r.subcommands).toEqual([]);
  });

  it("extracts 'setup' with subcommand", () => {
    const r = parseArgv(["setup", "luna-submodule"]);
    expect(r.namespace).toBe("setup");
    expect(r.subcommands).toEqual(["luna-submodule"]);
  });

  it("extracts 'setup fork' (macOS subcommand)", () => {
    const r = parseArgv(["setup", "fork"]);
    expect(r.namespace).toBe("setup");
    expect(r.subcommands).toEqual(["fork"]);
  });

  it("extracts 'setup all' as setup batch", () => {
    const r = parseArgv(["setup", "all"]);
    expect(r.namespace).toBe("setup");
    expect(r.subcommands).toEqual(["all"]);
  });

  it("preserves order of multiple setup subcommands", () => {
    const r = parseArgv(["setup", "gitignore", "lfs"]);
    expect(r.namespace).toBe("setup");
    expect(r.subcommands).toEqual(["gitignore", "lfs"]);
  });
});

describe("parseArgv — noun namespaces", () => {
  it("extracts 'packages' as namespace", () => {
    const r = parseArgv(["packages"]);
    expect(r.namespace).toBe("packages");
    expect(r.subcommands).toEqual([]);
  });

  it("extracts noun verb as subcommand: packages export", () => {
    const r = parseArgv(["packages", "export"]);
    expect(r.namespace).toBe("packages");
    expect(r.subcommands).toEqual(["export"]);
  });

  it("'import' is no longer a namespace — falls to subcommands", () => {
    const r = parseArgv(["import", "all"]);
    expect(r.namespace).toBeNull();
    expect(r.subcommands).toEqual(["import", "all"]);
  });

  it("'export' is no longer a namespace — falls to subcommands", () => {
    const r = parseArgv(["export"]);
    expect(r.namespace).toBeNull();
    expect(r.subcommands).toEqual(["export"]);
  });

  it("bare 'all' is NOT a namespace — falls to subcommands", () => {
    const r = parseArgv(["all"]);
    expect(r.namespace).toBeNull();
    expect(r.subcommands).toEqual(["all"]);
  });
});

describe("parseArgv — value flags --from / --to", () => {
  it("parses --from with its value", () => {
    const r = parseArgv(["packages", "export", "--from", "/projects/hub/Assets"]);
    expect(r.from).toBe("/projects/hub/Assets");
    expect(r.subcommands).toEqual(["export"]);
    expect(r.warnings).toEqual([]);
  });

  it("collects repeated --to values in order", () => {
    const r = parseArgv(["packages", "import", "--to", "/a", "--to", "/b"]);
    expect(r.to).toEqual(["/a", "/b"]);
  });

  it("--to without a value warns and is ignored", () => {
    const r = parseArgv(["packages", "import", "--to"]);
    expect(r.to).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("--to");
  });

  it("--to followed by a flag does not swallow the flag", () => {
    const r = parseArgv(["packages", "import", "--to", "-n"]);
    expect(r.to).toEqual([]);
    expect(r.dryRun).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("value flags mix with boolean flags and positionals", () => {
    const r = parseArgv(["-y", "packages", "import", "--to", "/a", "-n"]);
    expect(r.namespace).toBe("packages");
    expect(r.subcommands).toEqual(["import"]);
    expect(r.autoYes).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.to).toEqual(["/a"]);
  });

  it("supports the equals form: --from=/x and --to=/y", () => {
    const r = parseArgv(["packages", "import", "--from=/x", "--to=/y", "--to=/z"]);
    expect(r.from).toBe("/x");
    expect(r.to).toEqual(["/y", "/z"]);
    expect(r.warnings).toEqual([]);
  });

  it("equals form with empty value warns and is ignored", () => {
    const r = parseArgv(["packages", "import", "--to="]);
    expect(r.to).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("parseArgv — value flag --target", () => {
  it("parses --target with its value", () => {
    const r = parseArgv(["gitignore", "--target", "/p/Game/Assets"]);
    expect(r.target).toBe("/p/Game/Assets");
    expect(r.subcommands).toEqual(["gitignore"]);
    expect(r.warnings).toEqual([]);
  });

  it("supports the equals form: --target=/path", () => {
    const r = parseArgv(["gitignore", "--target=/p/Game/Assets"]);
    expect(r.target).toBe("/p/Game/Assets");
    expect(r.warnings).toEqual([]);
  });

  it("--target at end of argv warns and is ignored", () => {
    const r = parseArgv(["gitignore", "--target"]);
    expect(r.target).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("--target");
  });

  it("--target followed by a flag does not swallow the flag", () => {
    const r = parseArgv(["gitignore", "--target", "--yes"]);
    expect(r.target).toBeUndefined();
    expect(r.autoYes).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("repeated --target keeps the last value", () => {
    const r = parseArgv(["gitexclude", "--target", "/a", "--target", "/b"]);
    expect(r.target).toBe("/b");
  });
});

describe("parseArgv — value flag --store", () => {
  it("parses --store with its value", () => {
    const r = parseArgv(["packages", "export", "--store", "/bundle/store"]);
    expect(r.store).toBe("/bundle/store");
    expect(r.subcommands).toEqual(["export"]);
    expect(r.warnings).toEqual([]);
  });

  it("supports the equals form: --store=/path", () => {
    const r = parseArgv(["packages", "import", "--store=/bundle/store"]);
    expect(r.store).toBe("/bundle/store");
    expect(r.warnings).toEqual([]);
  });

  it("--store at end of argv warns and is ignored", () => {
    const r = parseArgv(["packages", "export", "--store"]);
    expect(r.store).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("--store");
  });

  it("--store followed by a flag does not swallow the flag", () => {
    const r = parseArgv(["packages", "export", "--store", "-n"]);
    expect(r.store).toBeUndefined();
    expect(r.dryRun).toBe(true);
    expect(r.warnings).toHaveLength(1);
  });

  it("equals form with empty value warns and is ignored", () => {
    const r = parseArgv(["packages", "export", "--store="]);
    expect(r.store).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
  });

  it("repeated --store keeps the last value", () => {
    const r = parseArgv(["packages", "import", "--store", "/a", "--store", "/b"]);
    expect(r.store).toBe("/b");
  });

  it("mixes --store with other value + boolean flags", () => {
    const r = parseArgv(["-y", "packages", "import", "--store", "/s", "--to", "/t"]);
    expect(r.store).toBe("/s");
    expect(r.to).toEqual(["/t"]);
    expect(r.autoYes).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// `scvn mcp` — namespace, --addons, --force, --purge-nuget
// ---------------------------------------------------------------------------

describe("mcp namespace + flags", () => {
  it("classifies mcp as a namespace and keeps the verb as a subcommand", () => {
    const r = parseArgv(["mcp", "status"]);
    expect(r.namespace).toBe("mcp");
    expect(r.subcommands).toEqual(["status"]);
  });

  it("keeps a bare `mcp` as a namespace with no verb (dispatch prints the hint)", () => {
    const r = parseArgv(["mcp"]);
    expect(r.namespace).toBe("mcp");
    expect(r.subcommands).toEqual([]);
  });

  it("keeps the update positional after the verb", () => {
    const r = parseArgv(["mcp", "update", "0.82.3"]);
    expect(r.subcommands).toEqual(["update", "0.82.3"]);
  });

  it("captures --addons as a CSV value", () => {
    const r = parseArgv(["mcp", "install", "--addons", "animation,particlesystem"]);
    expect(r.addons).toBe("animation,particlesystem");
    expect(r.subcommands).toEqual(["install"]);
  });

  it("accepts the --addons=a,b equals form", () => {
    expect(parseArgv(["mcp", "install", "--addons=animation"]).addons).toBe("animation");
  });

  it("warns and ignores --addons with no value, without swallowing the next flag", () => {
    const r = parseArgv(["mcp", "install", "--addons", "-y"]);
    expect(r.addons).toBeUndefined();
    expect(r.autoYes).toBe(true);
    expect(r.warnings[0]).toContain("--addons");
  });

  it("parses --force and --purge-nuget as booleans", () => {
    const r = parseArgv(["mcp", "uninstall", "--force", "--purge-nuget"]);
    expect(r.force).toBe(true);
    expect(r.purgeNuget).toBe(true);
  });

  it("defaults --force and --purge-nuget to false", () => {
    const r = parseArgv(["mcp", "install"]);
    expect(r.force).toBe(false);
    expect(r.purgeNuget).toBe(false);
  });

  it("does not confuse --exclude (a git op) with the mcp flags", () => {
    const r = parseArgv(["git", "--exclude"]);
    expect(r.exclude).toBe(true);
    expect(r.force).toBe(false);
  });
});
