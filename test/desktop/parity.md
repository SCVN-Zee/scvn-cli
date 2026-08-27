# Desktop ⇄ CLI parity checklist

The desktop app never forks business logic: every capability runs the **same**
`src/commands/*` handler (or its extracted `*Execute` half) as the CLI. The only
difference is the injected I/O adapter — `PromptAdapter`/`OutputAdapter` are the
GUI-backed implementations instead of the clack-backed ones. So on-disk results
are identical by construction; this checklist is the guard that proves it.

## Automated coverage (runs in `npm test`)

| Capability | Test | What it proves |
|---|---|---|
| `config` | `test/desktop/host-dispatch.test.ts` → "GUI adapter parity with the CLI" | GUI-written `~/.scvn/config` is **byte-identical** to the CLI-written file; the dir prompt carries `kind: "dir"` so main opens the native picker. |
| `config` (form) | `test/commands/config.test.ts` → "runConfigExecute() — GUI form write half" | The form's write half validates + persists exactly like the CLI loop's tail. |
| `fork` | `test/commands/fork.test.ts` → `forkPreflight()` / `forkExecute()` | Preflight blockers + the prefs write match the CLI flow; `runFork` still composes them unchanged. |
| `fork` merge attrs | `test/features/setup-merge-attributes.test.ts` | The Fork form's optional "write Unity merge `.gitattributes`" step reuses the CLI writer `writeGitAttributes()` via `setupMergeAttributes` (`src/features/setup/`); the host forks no write logic — it only resolves the picked project and toggle. |
| `setup` | `test/commands/shared/select-setup-target.test.ts` | The form's discovery step returns the same project list the CLI picker uses. |
| routing | `test/desktop/host-dispatch.test.ts` → "registry exposes form prepare/execute routes" | Every form capability has a `prepare` + execute route; guided ones do not. |
| `mcp` (reconfigure) | `test/features/mcp-reconfigure.test.ts` | The host `mcp` handler forwards `{verb, target, addons, version, force}` to the same `runMcp`; `reconfigure` re-vendors an installed project's edited addon set (and/or an explicit chooser `coreVersion`) through the shared `attachMcp` reconcile path — the pin-skew gate still refuses a skewed core unless `force`, matching install. |
| `mcp:check-updates` | `test/features/mcp-check-updates.test.ts` | The MCP tab's online check composes the same `resolveCoherentCore`→`resolveVersions` resolvers the CLI uses, and exposes the version chooser's menu (`coreVersions`, newest-first) plus its compatible subset (`compatibleCores`); read-only orientation, fail-soft to `offline:true`, forks no business logic. |

The dispatcher/cancel tests in the same file prove a cancelled prompt unwinds as
`PromptCancelled` and the host survives.

## Manual parity smoke (pre-release, needs a throwaway Unity project)

Run each against a **copy** of a fixture project, once via the CLI and once via
the packaged app, then `diff -r` the touched files. Expect zero diff.

1. **Build the app:** `npm run desktop:pack` → open
   `dist-desktop-pack/mac-arm64/Supercent VN Tools.app`.
2. **git** — `scvn git --ignore --exclude --lfs --target <fixture>/Assets` vs the
   Git capability with the same checkboxes + folder. Diff `.gitignore`,
   `.git/info/exclude`, `.gitattributes`.
3. **packages** — `scvn packages` export from a source project vs the Packages
   capability (export). Diff the produced snapshot.
4. **fork** *(macOS with Fork.app + Beyond Compare + Unity)* — `scvn fork -n` vs
   the Fork form with Dry run checked. Both report the same pending writes.

## Headless launch smoke (CI-friendly)

The packaged app boots the full renderer → main → utility-host → real-capability
pipe and exits 0:

```sh
SCVN_DESKTOP_SELFTEST=doctor \
  "dist-desktop-pack/mac-arm64/Supercent VN Tools.app/Contents/MacOS/Supercent VN Tools"
echo $?   # 0
```

`SCVN_DESKTOP_SELFTEST=<command>` runs any registered command (`ping`,
`doctor`, `config:prepare`, `mcp:project-status`) in the real utility process and
exits 0/1 on its result — no window interaction required.
