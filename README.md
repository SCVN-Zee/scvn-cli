# scvn

Unified Unity tooling CLI — stage shared assets once, apply them to a target
project. Linear command flows for managing a library of Unity editor
packages (add / remove / import), bootstrapping, and configuring Unity projects.

## Installation (one-time)

Build the CLI once, then add `<repo>/bin` to your `PATH` in `~/.zshrc` or `~/.bashrc`:

```sh
# from the repo root
npm install
make build

export PATH="$PATH:/path/to/scvn-cli/bin"
```

Then verify with:

```sh
scvn doctor
```

> **Building from source needs Node 20+.** A delivered bundle (`make pack`) carries its own Node
> runtime, so the consumer's Mac needs no Node install (see "Deliver to a teammate").

## Usage

```
scvn <command> [verb] [flags]
```

Running `scvn` with no arguments prints help and exits.

## The store model

`scvn` maintains a **library** of staged packages in a local snapshot store at
`~/.scvn/store/`:

1. **add** — copy a chosen folder (inside a Unity project's `Assets/`) into the
   library. Adds accumulate: adding another folder keeps what is already staged.
2. **remove** — drop staged packages from the library.
3. **import** — apply selected staged packages TO a target project.

Each staged package carries its own provenance (`hub @ main, 2d ago, 142.0 MB`),
so a library built from several source projects shows where each package came
from. Import lists the library and lets you pick a subset (defaults to all).
`scvn doctor` also reports what is currently staged. (`export` is a back-compat
alias for `add`.)

## Commands

### `scvn packages` — Unity editor packages

| Verb | Description |
|---|---|
| `add` | Copy a chosen folder inside a Unity project's `Assets/` into the library — accumulates across adds |
| `remove` | Remove selected staged packages from the library |
| `import` | Apply staged packages (subset selectable, defaults to all) to a target — single-select target |

`export` is a back-compat alias for `add`.

Bare `scvn packages` opens a verb menu.

#### How `add` picks a package

`add` opens a folder picker (a path prompt in the CLI, a native dialog in the
desktop app). Pick any folder **inside a Unity project's `Assets/`** — its
Assets-relative path is preserved, so a plugin at `…/ProjA/Assets/Plugins/Sirenix`
is stored under that path and `import` restores it to `Assets/Plugins/Sirenix` in
the target. The folder's paired Unity `.meta` sidecar is copied alongside it.

Picking the `Assets/` folder itself, or a folder outside any `Assets/` tree, is
rejected with a reason. Re-adding the same path updates its entry in place.

### `scvn mcp` — vendor Unity-MCP as `Assets/` source

Installs the AI Game Developer (Unity-MCP) plugin into a project by **copying it
in as ordinary `Assets/` source**, not through UPM. `Packages/manifest.json`,
`Packages/packages-lock.json`, and `ProjectSettings/PackageManagerSettings.asset`
therefore stay byte-equal to HEAD by construction, and the vendored tree is
git-excluded — so **after an install there is nothing to commit**, on any repo.

| Verb | Description |
|---|---|
| `status` | Staged versions + per-project install state. Offline, always |
| `install` | Vendor the source into a project, then write its `.mcp.json` |
| `uninstall` | Remove the vendored source (`--purge-nuget` also drops the NuGet DLLs) |
| `update [<coreVer>]` | Bump an installed project. An **older** `<coreVer>` is a rollback |

Bare `scvn mcp` prints the verb list and exits 1 (no menu — every mutating verb
targets a specific project).

```sh
scvn mcp status                                     # what's staged, who has it
scvn mcp install --target ~/p/Game/Assets           # picker offers the addons
scvn mcp install --target ~/p/Game/Assets --addons animation -y
scvn mcp update --target ~/p/Game/Assets            # bump to registry latest
scvn mcp update 0.83.0 --target ~/p/Game/Assets     # roll back (works offline)
scvn mcp uninstall --target ~/p/Game/Assets --purge-nuget
```

**The cache.** Versions are fetched from [OpenUPM](https://package.openupm.com),
integrity-checked (sha512), transformed, and staged under `~/.scvn/mcp/Unity-MCP V<ver>/`.
Staged versions are **never deleted**, which is what makes `scvn mcp update <olderVer>`
an offline rollback. `scvn doctor` reports the cache.

**Addons.** `--addons a,b` takes bare names (`animation`) or full package names.
Omit it and the picker offers the defaults. Every domain add-on is selectable,
`cinemachine` included — installing it pulls `com.unity.cinemachine 3.1.6`, which
UPM may force-upgrade a CM2 project to satisfy, so pick it deliberately.

**Gates.** install refuses an already-installed project (use `update`), a project
with Unity open, and an addon that pins a *different* core version — that last pair
compiles fine and then fails at runtime as an opaque MCP error. `--force` overrides
each; `-n` previews everything.

**Offline delivery.** `make pack` bundles the newest staged version plus the
`unity-mcp-cli` closure, so a teammate with **no Node and no network** can unzip a
bundle and run `scvn mcp install` (see "Deliver to a teammate"). `.mcp.json` is
written by the real `unity-mcp-cli` — it carries a per-project port that cannot be
derived, so scvn delegates rather than guesses.

> **`uninstall` leaves `.mcp.json` behind.** That file can hold *other* MCP servers,
> so removing it is not scvn's call. Delete it yourself if you want it gone.

### `scvn git` — git artifacts (.gitignore, exclude, LFS)

Flag-driven group. Pick at least one op; combine freely in one run. Bare
`scvn git` prints the flag hint and exits (no menu, no run-all).

| Flag | Description |
|---|---|
| `--ignore` | Install repo-root `.gitignore` template, remove every other (nested) `.gitignore`, then untrack any already-tracked files the new rules now ignore |
| `--exclude` | Write the bundled template into `.git/info/exclude` as a fenced block |
| `--lfs` | `git lfs install --local` + write the Unity binary-asset LFS-track block into repo-root `.gitattributes` |

Multiple flags run in the order `--ignore` → `--exclude` → `--lfs` under one
target resolution. `--lfs` needs the `git-lfs` binary (`brew install git-lfs`) —
if it's missing the LFS step fails with that hint (exit 1) while any other
selected ops still apply; `scvn doctor` reports git-lfs presence. The LFS block
is sourced from the bundled `templates/gitattributes-lfs` template (editable —
see below) and uses its own marker (`# BEGIN/END scvn-lfs`) so it coexists with
the fork smart-merge block in one `.gitattributes` (LFS = binary assets;
smart-merge = text YAML — disjoint types).

### Project bootstrap commands

Each bootstrap op is a top-level command:

| Command | Description |
|---|---|
| `scvn ignore-dirty` | Toggle `ignore=dirty` on the repo's git submodules (multi-select) |
| `scvn fork` | Configure Fork 2.64 for Unity merges (macOS only) |

Target resolution: `--target <Assets dir>` flag → `SCVN_TARGET` env →
interactive picker. Under `-y` an explicit target is required — ops never
auto-pick a project. `scvn fork` is the exception: it configures **Fork.app
only** (the `defaults write` prefs — Beyond Compare diff + UnityYAMLMerge). It
does not touch git config or any project's `.gitattributes`, so it needs no
target, no `SCVN_PROJECTS_ROOT`, and no project selection (`--target` is ignored
with a warning). Per-project git artifacts are `scvn git`'s job.

Bootstrap a fresh project in one line:

```sh
T=~/p/Game/Assets; scvn git --ignore --exclude --lfs --target $T -y && scvn ignore-dirty --target $T -y
```

> **`scvn git --exclude` preserves what it did not write.** The template goes into
> `.git/info/exclude` between `# >>> scvn >>>` / `# <<< scvn <<<` markers; hand-written
> lines and any other tool's fenced block survive untouched, and re-running refreshes
> only the scvn block. A file still holding a pre-marker copy of the template is
> migrated to the fenced form in place. The path comes from `git rev-parse --git-path`,
> so submodules and linked worktrees resolve correctly.

> **`scvn git --ignore` also prunes.** Beyond installing the root template it deletes
> every *other* (nested) `.gitignore` in the repo — silently, no confirm. Under `-y`
> (as in the one-liner above) it prunes without prompting; `-n` previews the removals.
> Files inside submodules and git-ignored dirs (`Library/`, `Temp/`, …) are never
> touched; a non-git target skips the prune. Removed files show as deletions in
> `git status` — commit them.

> **`scvn git --ignore` also untracks.** After installing the root template and
> pruning, it scans for files that are *already tracked* in the index but now match
> the fresh `.gitignore`, and `git rm --cached` them so they become untracked while
> staying on disk (surfaced as staged deletions to commit). `-n` previews the
> would-untrack list without touching the index; a non-git target skips cleanly.
> When the enclosing repo sits *above* the Unity project (nested / monorepo / an
> accidental `$HOME` repo) the wider blast radius is guarded exactly like prune:
> refused under `-y`, confirmed interactively before anything is untracked.

### Editable templates — the `~/.scvn/templates/` override layer

The three git artifacts are resolved through one read path that prefers a
user-level override over the bundled default. Drop a file at
`~/.scvn/templates/<name>` and both the CLI (`scvn git`) and the desktop app use
it; delete it to fall back to the bundled default. The override dir is probed on
every run (never cached), so an edit takes effect immediately — no restart.

| Artifact | Override file |
|---|---|
| `.gitignore` (`--ignore`) | `~/.scvn/templates/.gitignore` |
| `.git/info/exclude` (`--exclude`) | `~/.scvn/templates/git-exclude` |
| Git-LFS block (`--lfs`) | `~/.scvn/templates/gitattributes-lfs` |

With no override present, every artifact produces byte-identical output to the
bundled defaults. In the **desktop app's Git setup** view, each artifact toggle
carries an **Edit template…** link that opens a focused editor: it shows the
effective content with an override/default badge, **Save** writes the override,
and **Reset to default** removes it. Because both surfaces share this
read path, an edit made in the GUI is honored by a later `scvn git` run on the
CLI.

### `scvn config` — edit configuration

Interactively prompts for each setting and writes `~/.scvn/config`.

```sh
scvn config    # prompts for the Unity projects root, then saves
```

The prompt prefills the current value, expands `~`, and re-prompts until the
path is an existing directory. Under `-y`/non-TTY it can't prompt — it prints the
config path and exits so you can edit the file by hand.

### `scvn doctor` — run environment checks

Verifies runtime dependencies (`rsync`, `git`, `git-lfs`, `node`, plus on macOS:
Beyond Compare, Unity editors, Fork, mergespecfile) and reports the store status
(staged provenance per feature). Exit code is non-zero only when a check
fails; the store line is informational and never fails the run. `git-lfs` is a
**warn** (not fail) — it's needed only for `scvn git --lfs`.

**Examples:**

```sh
scvn packages add --from ~/p/Hub/Assets/Plugins/Sirenix  # copy a folder inside Assets/ into the library
scvn packages add --from ~/p/Hub/Assets/vFolders         # add more — earlier packages are kept
scvn packages remove                          # drop staged packages from the library
scvn packages import                          # apply selected staged packages to the target
scvn packages import --to ~/p/GameA/Assets -y # promptless (explicit target required)
scvn packages import -n                       # dry-run the apply
scvn git --ignore --target ~/p/GameA/Assets -y   # promptless: install root + prune nested + untrack now-ignored
scvn git --lfs --target ~/p/GameA/Assets -y      # git lfs install + LFS .gitattributes
scvn fork -n                                  # preview Fork merge config (macOS)
```

## Deliver to a teammate — `make pack`

`scvn packages add` stages assets into your machine's `~/.scvn/store/`. To hand
the packages to a teammate who has **no source project**, bundle the CLI
and the staged store into a single zip. `make pack` is a maintainer task (run
from the repo) — there is no `scvn pack` command:

```sh
# producer (you) — store already populated via scvn packages add
make pack          # build + bundle → pkg/scvn-bundle-<version>.zip
```

The zip holds the built CLI (`bin/`, `dist/`, `templates/`), an
`INSTALL.txt`, a copy of your `~/.scvn/store/` under `store/`, and — if you have
one staged — the newest MCP version plus its `unity-mcp-cli` under `mcp/`. Hand it
over (Drive, Slack, USB).

```sh
# consumer (teammate) — clean machine, empty ~/.scvn
unzip scvn-bundle-<version>.zip -d ~/scvn-bundle
export PATH="$PATH:$HOME/scvn-bundle/bin"    # Node is bundled — no install, no npm
scvn packages import --to /path/to/YourGame/Assets   # applies the staged packages
scvn mcp install --target /path/to/YourGame/Assets   # vendors Unity-MCP, offline
scvn doctor                                  # store + MCP lines show "(bundled)"
```

**MCP works with no network at all.** The bundle carries the vendored source *and*
the `unity-mcp-cli` closure, so `scvn mcp install` needs neither a registry nor a
Node install. It vendors whatever addon set the producer staged — a bundle that
shipped only `animation` installs exactly that, rather than trying to fetch the
rest. Naming `--addons` explicitly is still a hard request, and will fail offline
if the bundle lacks it.

**How the fallback works:** when `~/.scvn/store/` has nothing staged,
`scvn packages import` and `scvn doctor` automatically read the copy shipped inside the
bundle (resolved next to the CLI install). A teammate who later runs their own
`scvn packages add` shadows the bundled copy with their user store.

**Operate directly on the bundle's store.** By default `import` reads the bundle but `add`
writes your user store. To make **both** halves act on the bundle's `store/` — e.g. to add a
package and re-share the bundle — point `SCVN_STORE_DIR` (or `--store`) at it:

```sh
export SCVN_STORE_DIR="$HOME/scvn-bundle/store"
scvn packages add --from ~/p/Hub/Assets/vFolders  # stages INTO the bundle
scvn packages import --to ~/p/Game/Assets    # applies FROM the same bundle
scvn doctor                                  # store line shows the bundle (override)
```

An explicit override reads/writes only that directory — the automatic user→bundled fallback
applies only when no override is set.

**Self-contained:** the bundle ships a pinned **Node runtime** (`node/bin/node`) alongside the
dependency-bundled `dist/cli.mjs`, so the delivered CLI runs with **only the PATH entry** — no
Node install, no `node_modules`, no `npm install`. `scvn` prefers the bundled Node, falls back to
a system Node ≥ 20, and on a CPU mismatch (e.g. an arm64 bundle on an Intel Mac) guides a one-time
install. `scvn doctor` shows the active runtime (`(bundled)` vs `(system)`).

Build a smaller bundle that relies on the consumer's own Node with `make pack-no-node`. The
bundled Node is built for the **producer's** CPU; don't run two `make pack`s at once.

> **Licensing:** the bundle redistributes the staged editor packages (Odin,
> vFolders, …). Share it **internally only**, where your team's seat licenses
> cover redistribution.

## Desktop app (GUI)

The same tooling ships as a native macOS desktop app that drives every
capability through a GUI — folder pickers instead of typed paths, single-screen
forms instead of sequential prompts, and a live progress pane instead of
scrolling stdout. It reuses the exact same `src/` command layer as the CLI, so
on-disk results are identical (see `test/desktop/parity.md`).

```sh
npm run desktop:dev      # Vite dev server + Electron, hot-reload renderer
npm run desktop:build    # bundle main/preload/host (tsup) + renderer (Vite)
npm run desktop:pack     # unsigned local .app + .dmg → dist-desktop-pack/
```

`desktop:pack` produces `dist-desktop-pack/mac-arm64/scvn.app` (and a `.dmg`).
The build is **unsigned** — Gatekeeper will warn on first open; right-click →
Open, or `xattr -dr com.apple.quarantine scvn.app`. Signing and notarization are
a separate release step (below).

### Signed & notarized release

`desktop:pack` is intentionally unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
so anyone can build locally. For a distributable build that opens past
Gatekeeper on other Macs, use `desktop:release` on a machine with an Apple
Developer ID. The hardened runtime, entitlements
(`desktop/build/entitlements.mac*.plist`), and notarization are already wired in
`electron-builder.yml`; they activate only when signing credentials are present.

Prerequisites: an **Apple Developer Program** membership and a **Developer ID
Application** certificate in the login keychain (or provided via `CSC_LINK` +
`CSC_KEY_PASSWORD`). Provide notarization credentials via environment:

```sh
# Option A — Apple ID + app-specific password
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="ABCDE12345"

# Option B — App Store Connect API key
export APPLE_API_KEY="/path/to/AuthKey_XXXX.p8"
export APPLE_API_KEY_ID="XXXXXXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

npm run desktop:release   # signs (hardened runtime) + notarizes + staples
```

Verify the result: `spctl -a -vv dist-desktop-pack/mac-arm64/scvn.app` (accepted)
and `xcrun stapler validate dist-desktop-pack/scvn-*.dmg`.

### Automated release & in-app updates

Pushing a `v*` tag runs `.github/workflows/release.yml` on an Apple-Silicon
runner: it builds the desktop app, signs + notarizes it, and publishes a GitHub
Release with the `.dmg` (first install), a `.zip` + `latest-mac.yml` +
blockmaps (consumed by the in-app updater). The tag must match `package.json`
`version` (the workflow fails otherwise), so bump the version first:

```sh
npm version 0.6.0          # bumps package.json + creates the v0.6.0 tag
git push origin main --tags
```

The published build **hides the MCP tab**: the workflow sets
`SCVN_TABS=fork,git,packages,settings`, which the bundlers bake into both the
renderer catalog and the host command registry — the tab is neither rendered
nor invokable. To build such a variant locally, prefix any desktop script, e.g.
`SCVN_TABS=fork,git,packages,settings npm run desktop:pack`.

Required repository **secrets** (Settings → Secrets → Actions): `CSC_LINK`
(base64 of the Developer ID Application `.p12`), `CSC_KEY_PASSWORD`, and the
notarization trio `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`.
`GITHUB_TOKEN` (built-in) publishes the release. Auto-update on macOS only works
for a **signed + notarized** build — Squirrel refuses to swap an unsigned app.

Shipped copies self-update via `electron-updater`: the update banner checks the
GitHub Release on launch and, when a newer version exists, offers **Download
update** → progress → **Restart & install**. Downloads are user-initiated
(`autoDownload` is off); a downloaded update also installs on next quit. In dev
and the headless self-test the updater is not wired (no `app-update.yml`), so
the banner stays hidden.

Architecture: a sandboxed renderer (no Node access) draws the UI; the Electron
main process owns the window, native dialogs, and an IPC broker; a long-lived
Node **utility process** hosts the command layer. `fork`, `config`, and `setup`
use native forms (a `prepare` round-trip populates the form, submit runs the
capability); the rest use a guided-dialog flow over the prompt channel. The CLI
(`bin/scvn`) is unaffected — it ships independently via `package.json` `bin`.

## Flags

| Flag | Short | Description |
|---|---|---|
| `--dry-run` | `-n` | Preview changes without applying them |
| `--yes` | `-y` | Skip prompts — add auto-resolves the source; **imports then require `--to`, bootstrap ops require `--target`** |
| `--from <path>` | | Add source project (Assets dir) |
| `--to <path>` | | Import target project (Assets dir) — a single target per import |
| `--target <path>` | | Bootstrap-op / `scvn git` target project (Assets dir) — beats `SCVN_TARGET` env |
| `--ignore` | | `scvn git`: install repo-root `.gitignore` + prune nested + untrack now-ignored |
| `--exclude` | | `scvn git`: install `.git/info/exclude` |
| `--lfs` | | `scvn git`: `git lfs install --local` + LFS `.gitattributes` block |
| `--store <path>` | | Snapshot-store dir override for add/import/doctor — or `SCVN_STORE_DIR` env (flag wins) |
| `--addons <a,b>` | | `scvn mcp install`: addon selection (bare or full names) |
| `--force` | | `scvn mcp`: override a refusing gate (already installed, pin skew, Unity open) |
| `--purge-nuget` | | `scvn mcp uninstall`: also remove `Assets/Plugins/NuGet` |
| `--help` | `-h` | Show help text |
| `--version` | | Print version and exit |

`--from=/path` / `--to=/path` equals-forms are also accepted.

**Store override.** `--store <dir>` (or the `SCVN_STORE_DIR` env var — `--store` wins) points
**both** add and import — plus `scvn doctor` — at one snapshot store instead of
`~/.scvn/store`. Add writes `<dir>/packages`; import and doctor read `<dir>`
**only** (an explicit override disables the bundled-store fallback). It is read from the
flag/env per invocation, **not** persisted to `~/.scvn/config`. Handy for operating directly
on a delivered bundle's `store/` (see "Deliver to a teammate").

Safety rules: targets are never auto-picked. Import runs select one target
interactively (the staged source project is excluded) and require a single
`--to` under `-y`; bootstrap ops require `--target` (or `SCVN_TARGET`) under `-y`.
Interactive project pickers require `SCVN_PROJECTS_ROOT` — the first interactive
run without it opens `scvn config` for you to fill, then continues. Under
`-y`/non-TTY a flow that would pick a project exits 1 when `SCVN_PROJECTS_ROOT`
is not set (env/config) and no explicit path is passed. (`scvn fork` is exempt —
it picks no project and needs no root.) No command but `scvn config` writes the
config file.

## Configuration

Config file: `~/.scvn/config`

Plain `KEY=value` format, one per line. Comments with `#`.

| Key | Description | Example |
|---|---|---|
| `SCVN_PROJECTS_ROOT` | Path to your Unity projects directory (required for interactive project picking) | `/Users/you/Projects` |

All keys are also readable as environment variables — env vars take precedence
over the config file.

**Projects root is required for project pickers.** Commands that pick a project
interactively (`packages` import, bootstrap ops) need
`SCVN_PROJECTS_ROOT`. (`scvn fork` configures Fork.app only — no project, no root.) On first use without it,
scvn opens `scvn config` for you to fill, then continues the command — only
`scvn config` ever writes `~/.scvn/config`. A configured root that points to a
non-existent directory is treated as unset (same redirect). Under `-y` (or any
non-TTY), such a command exits 1 unless `SCVN_PROJECTS_ROOT` is valid (env or
config) or you pass an explicit `--from`/`--to`/`--target`.

**Example config:**

```
SCVN_PROJECTS_ROOT=/Users/you/Unity/Projects
```

## Migration

### v0.1 → v0.2: sync namespace replaced

The `sync` namespace was replaced by the noun-first export/import grammar.
Old commands print this table and exit 1:

| Old (v0.1) | New (v0.2) |
|---|---|
| `scvn sync toolkit` | removed (toolkit feature deleted) |
| `scvn sync packages` | `scvn packages add` then `scvn packages import` |
| `scvn sync mcp` | removed (MCP feature deleted) |
| `scvn sync all` / `scvn all` | `scvn packages import` |
| `scvn sync all -y` (auto target) | `scvn packages import -y --to <path>` — targets are now explicit |
| `SCVN_SRC` / `SCVN_TARGET` env (export/import flows) | `--from` / `--to` flags — note: `SCVN_TARGET` still presets bootstrap-op targets (`--target` flag wins) |

Also removed in v0.2: the MCP sync feature (`scvn sync mcp`, the
`SCVN_MCP_PACKAGE_DIR` config key, and the `claude` CLI doctor check).

### v0.2 → v0.3: setup namespace replaced

Bootstrap ops are top-level commands. `scvn setup …` (bare or with any
subcommand) prints this table and exits 1:

| Old (v0.2) | New (v0.3) |
|---|---|
| `scvn setup luna-submodule` | `scvn ignore-dirty` |
| `scvn setup gitignore` | `scvn git --ignore` |
| `scvn setup editorconfig` | `scvn editorconfig` |
| `scvn setup gitexclude` | `scvn git --exclude` |
| `scvn setup fork` | `scvn fork` |
| `scvn setup all` / operation menu | removed — run ops individually (chain with `&&`) |

Also in v0.3: bootstrap ops under `-y` require an explicit `--target` /
`SCVN_TARGET` — the first discovered project is no longer auto-picked.

### v0.3 → v0.4: `luna-submodule` → `ignore-dirty`

`scvn luna-submodule` was removed and replaced by `scvn ignore-dirty`. There is
**no shim** — the old command now errors as unknown.

| Old (v0.3) | New (v0.4) |
|---|---|
| `scvn luna-submodule` | `scvn ignore-dirty` |

What changed:

- **Scope:** the command now detects **every** submodule in the repo (not just
  `Supercent/Luna`) and offers each in a multi-select.
- **Behavior:** it is now a single **two-way `ignore=dirty` toggle** — the picker
  selection is the desired final state (selected → `ignore=dirty` set, deselected
  → unset; submit with nothing selected → unset all). The old Setup / Init /
  Update / Patch-`CollectionExtensions.cs` actions were dropped.
- Under `-y` it sets `ignore=dirty` on every submodule; `-n` previews; a repo with
  no submodules is a no-op (exit 0).
- **Removed config:** the `SCVN_SSH_HOST` key (only the old SSH-URL rewrite used
  it). An existing `SCVN_SSH_HOST` line is ignored and dropped on the next rewrite.

### v0.4 → v0.5: `gitignore` / `gitexclude` grouped into `scvn git`

`scvn gitignore` and `scvn gitexclude` were merged into one flag-driven
`scvn git` command (which also adds git-LFS setup). The old top-level commands
print this table and exit 1:

| Old (v0.4) | New (v0.5) |
|---|---|
| `scvn gitignore` | `scvn git --ignore` |
| `scvn gitexclude` | `scvn git --exclude` |
| — (new) | `scvn git --lfs` — `git lfs install --local` + LFS `.gitattributes` block |

`scvn ignore-dirty` is unchanged (still a top-level op).
Combine flags to bootstrap in one run: `scvn git --ignore --exclude --lfs`.

### v0.5 → v0.6: `scvn editorconfig` removed

`scvn editorconfig` and its bundled `.editorconfig` template were removed. The
command now errors as unknown — there is **no shim**. Manage `.editorconfig`
directly in your project; `scvn git` and `scvn ignore-dirty` are unaffected.

### v0.5 → v0.6: `unity-mcp-localize.sh` replaced by `scvn mcp`

The standalone bash script that vendored Unity-MCP (`SC_Projects/unity-mcp-localize.sh`)
is retired. It is archived, unmodified, at `docs/reference/unity-mcp-localize.sh`.

| Old (the script) | New |
|---|---|
| `unity-mcp-localize.sh` (bare) | `scvn mcp status` |
| `unity-mcp-localize.sh setup <repo>` | `scvn mcp install --target <Assets>` |
| `unity-mcp-localize.sh detach <repo>` | `scvn mcp uninstall --target <Assets>` |
| `unity-mcp-localize.sh update <repo> [ver]` | `scvn mcp update [<ver>] --target <Assets>` |
| `unity-mcp-localize.sh fetch [ver]` | folded into `install` (it stages what it needs) |
| `decommission`, `test` | dropped |

This is **not** the v0.2-removed `scvn sync mcp`, which was a different feature.

What changed beyond the name:

- **No python3, no bash, no npx.** The whole path is TypeScript; `.mcp.json` is written
  by invoking the cached `unity-mcp-cli` through the running Node (`process.execPath`).
- **Tarballs are verified** against the registry's sha512 before extraction. The script
  checked nothing.
- **Repos it wired keep working.** Its marker (`.unity-mcp-localize.json`) and its
  `# >>> unity-mcp-localize >>>` exclude fence are both read and migrated on the next
  `scvn mcp` run — no reinstall needed.
- **Offline delivery.** `make pack` bundles the cache, so a teammate with no Node and
  no network can install (the script could not).

### From sync-unity / fork-unity-setup

**Existing configs auto-migrate.** On first run, scvn:

1. Copies `~/.config/scvn/{config,history.jsonl}` (previous scvn home) into
   `~/.scvn/` if the new home is empty. Originals are left untouched.
2. Otherwise reads `~/.config/sync-unity/config` and writes `~/.scvn/config`.

The migration is one-shot — no-op if `~/.scvn/config` already exists.

Old env-var mapping:

| Old variable | New variable |
|---|---|
| `SYNC_UNITY_PROJECTS_ROOT` | `SCVN_PROJECTS_ROOT` |

## Troubleshooting

**`command not found: scvn`**
`<repo>/bin` is not on your PATH. Add it (run from the repo root):
```sh
make build
export PATH="$PATH:$(pwd)/bin"
```
Then run `scvn doctor` to confirm everything resolves.

**``Nothing staged — run `scvn packages add` first``**
The import side reads from the store — stage content first with
`scvn packages add`. `scvn doctor` shows what is
currently staged.

**Store taking too much disk**
The store holds one copy of each staged package under `~/.scvn/store/`
(potentially a few hundred MB with large packages). Safe to reset:
`rm -rf ~/.scvn/store` — re-add to stage again.

**`rsync <3.1 detected; progress bars use file-level fallback`**
Install a modern rsync: `brew install rsync`

**`scvn fork` errors on Linux/Windows**
`fork` is macOS only. It requires Fork.app and the `defaults` command.

**`SCVN_PROJECTS_ROOT not set`**
An interactive command needs your Unity projects root. On first use scvn opens
`scvn config` for you to fill, then continues. To set it yourself: run
`scvn config`, export `SCVN_PROJECTS_ROOT` in the environment, or pass an
explicit `--from`/`--to`/`--target`. A configured path that no longer exists
triggers the same redirect. Under `-y`/non-TTY the value is mandatory — the
command exits 1 without it.

**Config not picked up**
Check that `~/.scvn/config` exists and has correct `KEY=value` syntax
(`cat ~/.scvn/config`). Remember env vars override file values.

**Migration didn't run / old config not found**
Migration is a one-shot guard: it skips if `~/.scvn/config` already exists.
To re-trigger: `rm ~/.scvn/config` and run `scvn` once.
