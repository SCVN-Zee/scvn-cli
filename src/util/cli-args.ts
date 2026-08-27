/**
 * util/cli-args.ts — Lightweight argv parser for scvn.
 *
 * The first non-flag positional is checked against KNOWN_NAMESPACES; if it
 * matches, it is consumed as `namespace` and the rest become `subcommands`.
 * If the first positional is not a known namespace it falls through to
 * `subcommands` unchanged.
 *
 * Recognised flags:
 *   -n, --dry-run    Enable dry-run mode
 *   -y, --yes        Enable auto-yes (skip prompts)
 *   -h, --help       Print help and exit
 *   --version        Print version and exit
 *   --from <path>    Export source project (value-taking)
 *   --to <path>      Import target project (value-taking, repeatable)
 *   --target <path>  Setup-op target project (value-taking, last wins)
 *   --store <path>   Snapshot-store dir override (value-taking, last wins)
 *   --addons <csv>   `scvn mcp` addon selection (value-taking, last wins)
 *   --force          Override a refusing gate (already-installed, pin skew, Unity running)
 *   --purge-nuget    `scvn mcp uninstall`: also remove Assets/Plugins/NuGet
 *
 * Namespace tokens (first positional, consumed before subcommands):
 *   packages | mcp | setup | config | doctor
 *   sync — still recognized, but only so the CLI can print the v0.2
 *          migration hint instead of silently showing help.
 *
 * Value flags missing their value (end of argv or another flag follows) are
 * treated as absent; a warning is collected for the caller to print.
 * Unknown flags are ignored silently (forward-compatibility).
 */

export interface ParsedArgs {
  help: boolean;
  version: boolean;
  dryRun: boolean;
  autoYes: boolean;
  /** `--ignore` — select the .gitignore op for `scvn git` */
  ignore: boolean;
  /** `--exclude` — select the .git/info/exclude op for `scvn git` */
  exclude: boolean;
  /** `--lfs` — select the git-LFS op for `scvn git` */
  lfs: boolean;
  /** `--force` — override a refusing gate (`scvn mcp`) */
  force: boolean;
  /** `--purge-nuget` — also remove Assets/Plugins/NuGet (`scvn mcp uninstall`) */
  purgeNuget: boolean;
  /** `--no-beyond-compare` — skip configuring Beyond Compare as Fork's diff tool (`scvn fork`); default true */
  beyondCompare: boolean;
  /** Namespace token if the first positional matched a known namespace */
  namespace: string | null;
  /** Positional subcommand tokens after the namespace (or all positionals if no namespace) */
  subcommands: string[];
  /** --from value (export source project path) */
  from?: string;
  /** --to values (import target project paths, repeatable) */
  to: string[];
  /** --target value (setup-op / init target Assets path, last occurrence wins) */
  target?: string;
  /** --store value (snapshot-store dir override, last occurrence wins) */
  store?: string;
  /** --addons value (`scvn mcp` addon CSV, last occurrence wins) */
  addons?: string;
  /** --name value (`scvn init` project directory name, last occurrence wins) */
  name?: string;
  /** --layout value (`scvn init` JSON manifest path, last occurrence wins) */
  layout?: string;
  /** Parse warnings for the caller to print (e.g. value flag without value) */
  warnings: string[];
}

/** Namespaces reserved by scvn. "sync" routes to the migration stub only. */
const KNOWN_NAMESPACES = new Set([
  "packages", "mcp", "setup", "config", "doctor", "sync",
]);

/** Flags that consume the next token as their value. */
const VALUE_FLAGS = new Set(["--from", "--to", "--target", "--store", "--addons", "--name", "--layout"]);

/**
 * Parse an argv array (pass `process.argv.slice(2)`).
 * Pure function — no side-effects; warnings are returned, not printed.
 */
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
  let beyondCompare = true;
  let namespace: string | null = null;
  let from: string | undefined;
  let target: string | undefined;
  let store: string | undefined;
  let addons: string | undefined;
  let name: string | undefined;
  let layout: string | undefined;
  const to: string[] = [];
  const subcommands: string[] = [];
  const warnings: string[] = [];

  // Single pass with index so value flags can consume their next token.
  const positionals: string[] = [];

  function assignValueFlag(flag: string, value: string): void {
    if (flag === "--from")         from = value;
    else if (flag === "--target")  target = value;
    else if (flag === "--store")   store = value;
    else if (flag === "--addons")  addons = value;
    else if (flag === "--name")    name = value;
    else if (flag === "--layout")  layout = value;
    else                           to.push(value);
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";

    switch (arg) {
      case "-h":
      case "--help":
        help = true;
        continue;

      case "--version":
        version = true;
        continue;

      case "-n":
      case "--dry-run":
        dryRun = true;
        continue;

      case "-y":
      case "--yes":
        autoYes = true;
        continue;

      // `scvn git` op-selector flags (boolean switches, global like -n/-y).
      case "--ignore":
        ignore = true;
        continue;

      case "--exclude":
        exclude = true;
        continue;

      case "--lfs":
        lfs = true;
        continue;

      // `scvn mcp` gate overrides / options (boolean switches).
      case "--force":
        force = true;
        continue;

      case "--purge-nuget":
        purgeNuget = true;
        continue;

      case "--no-beyond-compare":
        beyondCompare = false;
        continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const next = argv[i + 1];
      // A following flag token is NOT a value — don't swallow it
      if (next === undefined || next.startsWith("-")) {
        warnings.push(`${arg} requires a value — flag ignored`);
        continue;
      }
      assignValueFlag(arg, next);
      i++; // consume the value token
      continue;
    }

    // Equals form: --from=/path, --to=/path, --addons=a,b
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 2 && VALUE_FLAGS.has(arg.slice(0, equalsIndex))) {
      const key   = arg.slice(0, equalsIndex);
      const value = arg.slice(equalsIndex + 1);
      if (!value) {
        warnings.push(`${key} requires a value — flag ignored`);
        continue;
      }
      assignValueFlag(key, value);
      continue;
    }

    if (!arg.startsWith("-")) {
      positionals.push(arg);
    }
    // Unknown flags are silently ignored for forward-compatibility
  }

  // Classify first positional as namespace if it matches a reserved token.
  if (positionals.length > 0 && KNOWN_NAMESPACES.has(positionals[0] ?? "")) {
    namespace = positionals[0] ?? null;
    subcommands.push(...positionals.slice(1));
  } else {
    subcommands.push(...positionals);
  }

  return {
    help, version, dryRun, autoYes,
    ignore, exclude, lfs,
    force, purgeNuget, beyondCompare,
    namespace, subcommands,
    from, to, target, store, addons, name, layout,
    warnings,
  };
}
