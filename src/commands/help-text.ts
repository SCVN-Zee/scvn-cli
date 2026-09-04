/**
 * commands/help-text.ts — The `scvn -h` / bare-invocation help surface.
 */

export const HELP_TEXT = `
scvn — Unified Unity tooling CLI

Usage:
  scvn <command> [verb] [flags]

Commands:
  packages         Unity editor packages — a staged library: add / remove / import
  mcp              Vendor Unity-MCP into a project as Assets/ source
  init             Create a customizable Supercent directory hierarchy under Assets/
  fork             Configure Fork 2.64 for Unity merges (macOS only)
  git              Set up git artifacts — flags: --ignore / --exclude / --lfs
  ignore-dirty     Toggle ignore=dirty on the repo's git submodules
  config           Edit ~/.scvn/config
  doctor           Run environment checks

packages verbs (bare noun opens a menu):
  add              Stage packages from a source project into the library (accumulates)
  remove           Remove staged packages from the library
  import           Apply selected staged packages to a target project
                   (export is a back-compat alias for add)

mcp verbs (bare noun prints this hint):
  status           staged versions + per-project install state (offline)
  install          Vendor packages and write the selected project-local agent config
  uninstall        Remove the vendored source (--purge-nuget also drops the DLLs)
  update [<ver>]   Update an installed project; an older <ver> is an offline rollback
  reconfigure      Change extensions and regenerate the selected agent config

git ops (scvn git — pick ≥1 flag; combine freely):
  --ignore         Install repo-root .gitignore + prune nested
  --exclude        Write the bundled template into .git/info/exclude as a fenced block
  --lfs            git lfs install --local + LFS .gitattributes block

Flags:
  -n, --dry-run    Preview changes without applying
  -y, --yes        Skip prompts (init requires --target and --name; imports require --to)
  --from <path>    Add source project (Assets dir)
  --to <path>      Import target project (Assets dir, repeatable)
  --target <path>  Bootstrap-op / git / mcp / init target Assets dir
  --name <name>    scvn init default hierarchy project name (without --layout)
  --layout <file>  scvn init full Assets-relative JSON hierarchy
  --store <path>   Snapshot-store dir override (export/import/doctor; or SCVN_STORE_DIR)
  --addons <a,b>   scvn mcp install/reconfigure: extension selection
  --agent <id>     project-local agent config target
  --no-tools       omit MCP tools from generated config
  --no-prompts     omit MCP prompts from generated config
  --no-resources   omit MCP resources from generated config
  --force          scvn mcp: override a refusing gate (installed, pin skew, Unity open)
  --purge-nuget    scvn mcp uninstall: also remove Assets/Plugins/NuGet
  --no-beyond-compare  scvn fork: skip configuring Beyond Compare as the diff tool
  -h, --help       Show this help
  --version        Print version
`.trim();
