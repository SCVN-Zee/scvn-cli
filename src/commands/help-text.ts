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
  status           Staged versions + per-project install state (offline)
  install          Vendor Unity-MCP + write the project's .mcp.json
  uninstall        Remove the vendored source (--purge-nuget also drops the DLLs)
  update [<ver>]   Bump an installed project; an older <ver> is an offline rollback

git ops (scvn git — pick ≥1 flag; combine freely):
  --ignore         Install repo-root .gitignore + prune nested
  --exclude        Write the bundled template into .git/info/exclude as a fenced block
  --lfs            git lfs install --local + LFS .gitattributes block

Flags:
  -n, --dry-run    Preview changes without applying
  -y, --yes        Skip prompts (imports require --to; bootstrap ops require --target)
  --from <path>    Add source project (Assets dir)
  --to <path>      Import target project (Assets dir, repeatable)
  --target <path>  Bootstrap-op / git / mcp target project (Assets dir)
  --store <path>   Snapshot-store dir override (export/import/doctor; or SCVN_STORE_DIR)
  --addons <a,b>   scvn mcp install: addon selection
  --force          scvn mcp: override a refusing gate (installed, pin skew, Unity open)
  --purge-nuget    scvn mcp uninstall: also remove Assets/Plugins/NuGet
  --no-beyond-compare  scvn fork: skip configuring Beyond Compare as the diff tool
  -h, --help       Show this help
  --version        Print version
`.trim();
