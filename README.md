# Supercent VN Tools

A native macOS app that sets up and maintains Unity projects for the Supercent
Vietnam workflow — merge-tool configuration, git artifacts, a shared package
library, and project scaffolding — entirely through a GUI: folder pickers
instead of typed paths, streaming output, no terminal required.

The same engine also ships as the `scvn` command-line tool; see
[CLI.md](CLI.md) for the full CLI reference.

> **Requirements:** an Apple Silicon Mac. Most tabs need at least one Unity
> project; the [Fork](#fork--merge-tool-for-unity-yaml) tab needs
> [Fork](https://git-fork.com) installed.

---

## Install

1. **Download** the latest release from
   [GitHub Releases](https://github.com/Supercent-Vietnam/scvn-cli/releases/latest)
   — grab the `Supercent-VN-Tools-<version>-arm64.dmg` file.
2. Open the `.dmg` and drag **Supercent VN Tools** into your
   **Applications** folder.
3. **Remove the quarantine flag (one-time).** The app is distributed without
   an Apple Developer certificate, so macOS Gatekeeper may refuse to open it
   with *"Supercent VN Tools is damaged and can't be opened"* or an
   *"unidentified developer"* warning. Open **Terminal** and run:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Supercent VN Tools.app"
   ```

   After this the app opens normally. You only need to do this once per
   install (and again after replacing the app with a manually downloaded
   update).

4. Launch **Supercent VN Tools** from Applications.

---

## First run

The first launch walks you through a short onboarding (also replayable anytime
via the **?** button in the sidebar):

1. **Unity projects root** — pick the folder that contains your Unity projects
   (for example `~/p`). This is where every project picker starts. Save it.
2. **Doctor checklist** — a quick report of your environment (git, rsync,
   Unity editors, Fork, Beyond Compare, …). Advisory only — you can finish
   regardless and fix warnings later under Settings → Doctor.

Choose **Skip for now** to enter the app without finishing; a banner reminds
you and onboarding reappears on the next launch until the projects root is
saved.

---

## The tabs

The sidebar shows what your build ships — in released builds:
**Fork · Git setup · Packages · Initialize · Settings**.

### Fork — merge tool for Unity YAML

Teaches the [Fork](https://git-fork.com) git client to merge Unity's YAML
assets (`.meta`, scenes, prefabs) with Unity's own `UnityYAMLMerge` instead of
plain text merge.

- **Unity editor** — pick which installed editor version performs merges.
- **Configure Beyond Compare (diff tool)** — optional; on by default when
  Beyond Compare is installed.
- **Also write Unity merge .gitattributes to a project** — optional second
  half: writes the smart-merge block into a chosen project's `.gitattributes`
  (pick the project when enabled; the ✎ icon lets you edit the template
  first).
- If Fork is running, **Apply** asks to quit it, applies the settings, then
  reopens it.

This writes Fork's preferences only — it never touches git config; per-project
git files are [Git setup](#git-setup--gitignore--exclude--lfs)'s job.

### Git setup — .gitignore / exclude / LFS

Pick a project at the top, then run any of the three ops — each has its own
button and a ✎ icon to review or edit the template before running:

| Op | What it does |
|---|---|
| **Install .gitignore** | Writes the repo-root `.gitignore`, prunes nested `.gitignore` files, and untracks already-committed files the new rules ignore |
| **Install .git/info/exclude** | Writes local-only excludes that are never committed |
| **Install Git LFS** | `git lfs install` for the repo + binary-asset tracking rules in `.gitattributes` (needs `git-lfs`; see Troubleshooting) |

Below the ops: a live **ignore=dirty** toggle per git submodule. Flipping a
toggle applies immediately to the repo's local `.git/config` only — never to
the tracked `.gitmodules`.

Template edits made via the ✎ icons are saved under `~/.scvn/templates/` and
are honored by the CLI too; **Reset to default** in the editor removes the
override.

### Packages — shared library

One library of staged package folders that you build once from a source
project and apply to any target project.

- **Add** — pick one or more folders **inside** a Unity project (under
  `Assets/`, `Packages/`, or a custom root folder). The project-relative path
  is preserved, the paired `.meta` file comes along, and provenance (source
  repo, when, size) is recorded. Adds accumulate — existing entries stay.
- **Import** — tick the rows (or a whole folder's select-all) and apply them
  to a target project. Runs with streaming progress.
- **Remove** — drop entries from the library.

The tree groups everything by where it lives (`Assets/…`, `Packages/…`,
custom root folders) so you can see what each package is before importing.
The library is stored under `~/.scvn/store/`.

### Initialize — folder scaffolding

Creates the standard Supercent directory hierarchy inside a project:

1. Pick the **target project**.
2. Review the **directory hierarchy** tree — fully editable: rename, remove,
   or add folders; **Load**/**Save** a layout as a JSON manifest to reuse it.
   The default is `Assets/Supercent/<ProjectName>/` with Animation, Audio,
   Configs, Models, Fonts, Materials, Prefabs, Scenes, Scripts, Shaders,
   Sprites, and Textures.
3. **Dry run** to preview, then **Create**.

Existing directories are preserved; existing files are never touched.

### Settings

- **Config** — view/change the Unity projects root.
- **Updates** — follow the **Stable** channel (full releases) or **Beta**
  (includes pre-releases); shows your current version.
- **Doctor** — run environment checks and watch the results stream in.

---

## Updating

- **Signed builds** check for updates automatically on launch. When one is
  available a banner appears: **Download update** → **Restart & install**.
  The channel (Stable/Beta) is chosen in Settings → Updates.
- **Unsigned builds** can't self-update. Download the newer `.dmg`, replace
  the app in Applications, and re-run the `xattr` command from the
  [install steps](#install). Your settings live in `~/.scvn/` and survive the
  replacement.

---

## Troubleshooting

**"Supercent VN Tools is damaged and can't be opened"**
The quarantine flag is set. Run the `xattr` command from the
[install steps](#install).

**Onboarding keeps appearing on every launch**
The Unity projects root isn't saved (or points at a missing folder). Set it
during onboarding or in Settings → Config.

**Fork tab shows a blocker**
Fork.app isn't installed (or wasn't found). Install Fork and re-open the tab.
Beyond Compare is optional — without it, only the Unity merge tool is
configured.

**Doctor warns about git-lfs**
Git LFS is only needed for the Git setup **Install Git LFS** op. Install it
with `brew install git-lfs` when you want that op.

**There is no MCP tab**
MCP management (vendoring the Unity-MCP plugin into a project) is CLI-only in
released builds — see [`scvn mcp` in CLI.md](CLI.md#scvn-mcp--vendor-unity-mcp-as-assets-source).

---

## Where things live

| Path | Purpose |
|---|---|
| `~/.scvn/config` | App configuration (the Unity projects root) |
| `~/.scvn/store/` | The staged package library |
| `~/.scvn/templates/` | Your template overrides (`.gitignore`, exclude, LFS/merge blocks) |

## The command line

Every capability above has a CLI equivalent, plus more (`scvn mcp`, one-line
bootstrap, offline bundles for teammates). See
[CLI.md](CLI.md).
