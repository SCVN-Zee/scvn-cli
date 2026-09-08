/** Lightweight argv parser for scvn. */

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  dryRun: boolean;
  autoYes: boolean;
  ignore: boolean;
  exclude: boolean;
  lfs: boolean;
  force: boolean;
  purgeNuget: boolean;
  namespace: string | null;
  subcommands: string[];
  from?: string;
  to: string[];
  target?: string;
  store?: string;
  addons?: string;
  agent?: string;
  enableAllTools: boolean;
  enableAllPrompts: boolean;
  enableAllResources: boolean;
  name?: string;
  layout?: string;
  warnings: string[];
}

const KNOWN_NAMESPACES = new Set(["packages", "mcp", "setup", "config", "doctor", "sync"]);
const VALUE_FLAGS = new Set(["--from", "--to", "--target", "--store", "--addons", "--agent", "--name", "--layout"]);

export function parseArgv(argv: string[]): ParsedArgs {
  let help = false;
  let version = false;
  let dryRun = false;
  let autoYes = false;
  let ignore = false;
  let exclude = false;
  let lfs = false;
  let force = false;
  let purgeNuget = false;
  let agent: string | undefined;
  let enableAllTools = true;
  let enableAllPrompts = true;
  let enableAllResources = true;
  let from: string | undefined;
  let target: string | undefined;
  let store: string | undefined;
  let addons: string | undefined;
  let name: string | undefined;
  let layout: string | undefined;
  const to: string[] = [];
  const positionals: string[] = [];
  const warnings: string[] = [];

  function assignValueFlag(flag: string, value: string): void {
    if (flag === "--from") from = value;
    else if (flag === "--to") to.push(value);
    else if (flag === "--target") target = value;
    else if (flag === "--store") store = value;
    else if (flag === "--addons") addons = value;
    else if (flag === "--agent") agent = value;
    else if (flag === "--name") name = value;
    else if (flag === "--layout") layout = value;
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "-h": case "--help": help = true; continue;
      case "--version": version = true; continue;
      case "-n": case "--dry-run": dryRun = true; continue;
      case "-y": case "--yes": autoYes = true; continue;
      case "--ignore": ignore = true; continue;
      case "--exclude": exclude = true; continue;
      case "--lfs": lfs = true; continue;
      case "--force": force = true; continue;
      case "--purge-nuget": purgeNuget = true; continue;
      case "--enable-all-tools": enableAllTools = true; continue;
      case "--enable-all-prompts": enableAllPrompts = true; continue;
      case "--enable-all-resources": enableAllResources = true; continue;
      case "--no-tools": case "--disable-all-tools": enableAllTools = false; continue;
      case "--no-prompts": case "--disable-all-prompts": enableAllPrompts = false; continue;
      case "--no-resources": case "--disable-all-resources": enableAllResources = false; continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        warnings.push(`${arg} requires a value — flag ignored`);
      } else {
        assignValueFlag(arg, next);
        i++;
      }
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const key = equalsIndex > 2 ? arg.slice(0, equalsIndex) : "";
    if (VALUE_FLAGS.has(key)) {
      const value = arg.slice(equalsIndex + 1);
      if (!value) warnings.push(`${key} requires a value — flag ignored`);
      else assignValueFlag(key, value);
      continue;
    }
    if (!arg.startsWith("-")) positionals.push(arg);
  }

  const namespace = positionals[0] !== undefined && KNOWN_NAMESPACES.has(positionals[0]) ? positionals[0] : null;
  const subcommands = namespace === null ? positionals : positionals.slice(1);
  return {
    help, version, dryRun, autoYes, ignore, exclude, lfs, force, purgeNuget,
    namespace, subcommands, from, to, target, store, addons, agent,
    enableAllTools, enableAllPrompts, enableAllResources, name, layout, warnings,
  };
}
