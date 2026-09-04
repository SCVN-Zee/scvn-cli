/**
 * desktop/main/index.ts — Electron main process: window + IPC broker.
 *
 * Owns the BrowserWindow and a single long-lived utility-process command host.
 * It relays the typed IPC protocol both ways (renderer ⇆ host) and watches the
 * host for exit so a hung/killed host is detected instead of freezing the UI.
 * Native dialogs (folder pickers) are owned here too (wired in Phase 3).
 */

import { app, BrowserWindow, dialog, ipcMain, screen, utilityProcess, type OpenDialogOptions, type SaveDialogOptions, type UtilityProcess } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import type { FromHost, PromptRequestMessage, ToHost, UpdateChannel, UpdateStatus } from "../shared/ipc.js";
import { loadConfig } from "../../src/config/load.js";
import electronUpdater from "electron-updater";
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampWindowState,
  defaultWindowState,
  parseWindowState,
  windowStateFromBounds,
  type WindowState,
} from "./window-state.js";

const CHANNEL_TO_HOST = "scvn:to-host";
const CHANNEL_FROM_HOST = "scvn:from-host";
const CHANNEL_HOST_STATUS = "scvn:host-status";
const CHANNEL_SELFTEST = "scvn:selftest";
const CHANNEL_PICK_DIR = "scvn:pick-dir";
const CHANNEL_PICK_SAVE = "scvn:pick-save";
const CHANNEL_UPDATE_STATUS = "scvn:update-status";
const CHANNEL_UPDATE_CHECK = "scvn:update-check";
const CHANNEL_UPDATE_DOWNLOAD = "scvn:update-download";
const CHANNEL_UPDATE_INSTALL = "scvn:update-install";
const CHANNEL_UPDATE_GET_CHANNEL = "scvn:update-get-channel";
const CHANNEL_UPDATE_SET_CHANNEL = "scvn:update-set-channel";

// Bundled to CJS by tsup, so __dirname resolves to dist-desktop/.
const HOST_ENTRY = path.join(__dirname, "host.cjs");
const PRELOAD_ENTRY = path.join(__dirname, "preload.cjs");
const RENDERER_HTML = path.join(__dirname, "renderer", "index.html");
const DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const SELFTEST = Boolean(process.env["SCVN_DESKTOP_SELFTEST"]);

const MAX_HOST_RESPAWNS = 5;

let mainWindow: BrowserWindow | null = null;
let host: UtilityProcess | null = null;
let hostRespawns = 0;

/** Fork the command host and relay its messages to the renderer. */
function spawnHost(): void {
  host = utilityProcess.fork(HOST_ENTRY, [], {
    serviceName: "scvn-host",
    env: { ...process.env, SCVN_HOST_EXEC_PATH: process.execPath },
  });

  host.on("message", (message: FromHost) => {
    // Directory/file text prompts are answered by a native picker in main,
    // never forwarded to the renderer (the headline folder-browse UX).
    if (message.kind === "prompt-request" && message.prompt.type === "text" &&
        (message.prompt.kind === "dir" || message.prompt.kind === "path")) {
      void answerWithNativePicker(message);
      return;
    }
    mainWindow?.webContents.send(CHANNEL_FROM_HOST, message);
  });

  host.on("spawn", () => process.stderr.write("host spawned\n"));
  host.on("exit", (code) => {
    mainWindow?.webContents.send(CHANNEL_HOST_STATUS, { kind: "host-exit", code });
    host = null;
    if (hostRespawns < MAX_HOST_RESPAWNS) {
      hostRespawns += 1;
      spawnHost();
      mainWindow?.webContents.send(CHANNEL_HOST_STATUS, { kind: "host-respawn", attempt: hostRespawns });
    }
  });
}

/** Send a message to the host, or surface an error if it is not running. */
function sendToHost(message: ToHost): void {
  if (!host) {
    if (message.kind === "invoke") {
      mainWindow?.webContents.send(CHANNEL_FROM_HOST, {
        kind: "error",
        requestId: message.requestId,
        name: "HostUnavailable",
        message: "Command host is not running",
      } satisfies FromHost);
    }
    return;
  }
  host.postMessage(message);
}

/** Home-expand a leading ~ so native dialogs open where the user expects. */
function expandDefault(raw: string | undefined): string | undefined {
  return raw?.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
}

/** Picker options relayed over CHANNEL_PICK_DIR; `multi` enables multi-selection. */
interface PickOptions { kind?: "dir" | "path"; title?: string; defaultPath?: string }

/** Open a native folder/file picker; returns the chosen path, or null when cancelled. */
async function openPathDialog(opts?: PickOptions): Promise<string | null>;
/** Multi-selection variant: every chosen path, or null when cancelled / nothing chosen. */
async function openPathDialog(opts: PickOptions & { multi: true }): Promise<string[] | null>;
async function openPathDialog(opts: PickOptions & { multi?: boolean } = {}): Promise<string | string[] | null> {
  const properties: OpenDialogOptions["properties"] =
    opts.kind === "path" ? ["openFile", "openDirectory"] : ["openDirectory"];
  if (opts.multi) properties.push("multiSelections");
  // Project pickers with no explicit start location open at the configured
  // Unity projects root (Settings → Config); loadConfig never throws, so an
  // unset/absent config just yields the OS default.
  const start = opts.defaultPath ?? (await loadConfig()).projectsRoot;
  const options: OpenDialogOptions = {
    properties,
    title: opts.title ?? "Select a folder",
    defaultPath: expandDefault(start),
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return null;
  return opts.multi
    ? (result.filePaths.length > 0 ? result.filePaths : null)
    : (result.filePaths[0] ?? null);
}

interface SaveOptions {
  title?: string;
  defaultPath?: string;
}

async function savePathDialog(opts: SaveOptions = {}): Promise<string | null> {
  const options: SaveDialogOptions = {
    title: opts.title ?? "Save layout manifest",
    defaultPath: expandDefault(opts.defaultPath),
  };
  const result = mainWindow
    ? await dialog.showSaveDialog(mainWindow, options)
    : await dialog.showSaveDialog(options);
  return result.canceled ? null : (result.filePath ?? null);
}

/** Answer a dir/file text prompt by opening a native picker; null = cancelled. */
async function answerWithNativePicker(message: PromptRequestMessage): Promise<void> {
  const { prompt, requestId, promptId } = message;
  if (prompt.type !== "text") return;
  const picked = await openPathDialog({
    kind: prompt.kind === "path" ? "path" : "dir",
    title: prompt.message,
    defaultPath: prompt.defaultValue,
  });
  sendToHost({ kind: "prompt-response", requestId, promptId, value: picked });
}

// electron-updater is CJS; default-import + destructure is the NodeNext-safe
// form (named ESM imports break at runtime for this dep).
const { autoUpdater } = electronUpdater;

/** Push an auto-update lifecycle event to the renderer's update banner. */
function sendUpdateStatus(status: UpdateStatus): void {
  mainWindow?.webContents.send(CHANNEL_UPDATE_STATUS, status);
}

// electron-updater is only wired for a packaged, non-self-test build; this flag
// gates the live retune in the set-channel handler (dev just persists the pref).
let autoUpdaterReady = false;

/** Path to the desktop-only update preferences file (main-owned, not the CLI config). */
function updatePrefsPath(): string {
  return path.join(app.getPath("userData"), "update-prefs.json");
}

/**
 * The update channel to use when nothing is persisted yet. A prerelease app
 * version (e.g. 0.6.0-beta.1) tracks `beta`; a plain release tracks `stable`.
 * This mirrors electron-updater's own default so existing installs are unchanged.
 */
function defaultUpdateChannel(): UpdateChannel {
  return app.getVersion().includes("-") ? "beta" : "stable";
}

/** Read the persisted channel, falling back to the build's own track. */
function readUpdateChannel(): UpdateChannel {
  try {
    const parsed = JSON.parse(fs.readFileSync(updatePrefsPath(), "utf8")) as { channel?: unknown };
    if (parsed.channel === "beta" || parsed.channel === "stable") return parsed.channel;
  } catch {
    // Missing/corrupt prefs → fall through to the build default.
  }
  return defaultUpdateChannel();
}

/** Persist the chosen channel; a write failure is logged, never fatal. */
function writeUpdateChannel(channel: UpdateChannel): void {
  try {
    fs.writeFileSync(updatePrefsPath(), `${JSON.stringify({ channel }, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`update-prefs write failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/** Path to the last BrowserWindow geometry (main-owned, not the CLI config). */
function windowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

/** Read saved geometry, falling back to 1224×918. Never throws. */
function loadWindowState(): WindowState {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    const state = parseWindowState(parsed);
    if (state) return state;
  } catch {
    // Missing/corrupt prefs → fall through to the first-launch default.
  }
  return defaultWindowState();
}

/**
 * Persist the window's normal bounds. Zoomed/fullscreen sessions save
 * getNormalBounds() plus isMaximized so a later launch is not a huge normal
 * window. Self-test never writes (must not pollute userData). A write failure
 * is logged, never fatal.
 */
function saveWindowState(win: BrowserWindow): void {
  if (SELFTEST || win.isDestroyed()) return;
  const isMaximized = win.isMaximized();
  const bounds = isMaximized || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  const state = windowStateFromBounds(bounds, isMaximized);
  try {
    fs.writeFileSync(windowStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`window-state write failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * Tune the updater to a channel. Both flags are set explicitly, in both
 * directions, because electron-updater only sets them for you via the `channel`
 * setter (which we don't use — we drive one GitHub repo by allowPrerelease):
 *  - stable: full releases only (allowPrerelease off), and allowDowngrade ON so
 *    a tester leaving beta can return to the current stable even though it is a
 *    lower semver than their prerelease build (e.g. 0.5.2 < 0.6.0-beta.1).
 *  - beta: also consider prereleases; roll-forward only (no downgrade needed).
 */
function applyUpdateChannel(channel: UpdateChannel): void {
  autoUpdater.allowPrerelease = channel === "beta";
  autoUpdater.allowDowngrade = channel === "stable";
}

/**
 * Wire electron-updater to the renderer. The UI drives the flow: it checks on
 * mount, downloads on user request (autoDownload off), and restarts to install.
 * Only meaningful for a packaged, signed build served an app-update.yml, so dev
 * and the headless self-test are skipped (electron-updater would error there).
 */
function setupAutoUpdater(): void {
  if (!app.isPackaged || SELFTEST) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Honor the persisted channel: sets allowPrerelease + allowDowngrade together.
  applyUpdateChannel(readUpdateChannel());

  autoUpdater.on("checking-for-update", () => sendUpdateStatus({ phase: "checking" }));
  autoUpdater.on("update-available", (info) =>
    sendUpdateStatus({
      phase: "available",
      version: info.version,
      notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
    }),
  );
  autoUpdater.on("update-not-available", () => sendUpdateStatus({ phase: "not-available" }));
  autoUpdater.on("download-progress", (p) =>
    sendUpdateStatus({
      phase: "downloading",
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    sendUpdateStatus({ phase: "downloaded", version: info.version }),
  );
  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    // A missing update manifest is not a failure: it means no installable
    // update is currently advertised. This happens transiently while a new
    // release is still publishing (the pushed tag is already discoverable but
    // its latest-mac.yml asset 404s until the release goes live) and
    // permanently for an unsigned build whose manifest was pruned. Surface it
    // as "no update available", not a red error banner the user can only retry.
    if (/HttpError: 404|Cannot find .*\.ya?ml/i.test(message)) {
      sendUpdateStatus({ phase: "not-available" });
      return;
    }
    sendUpdateStatus({ phase: "error", message });
  });

  // Renderer-driven controls (errors surface via the `error` event above).
  ipcMain.on(CHANNEL_UPDATE_CHECK, () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });
  ipcMain.on(CHANNEL_UPDATE_DOWNLOAD, () => {
    autoUpdater.downloadUpdate().catch(() => {});
  });
  ipcMain.on(CHANNEL_UPDATE_INSTALL, () => autoUpdater.quitAndInstall());

  autoUpdaterReady = true;
}

function createWindow(): void {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const state = clampWindowState(loadWindowState(), workAreas);

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Supercent VN Tools",
    backgroundColor: "#121218",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: PRELOAD_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (state.isMaximized) mainWindow.maximize();

  // The self-test env value doubles as the command to run ("1" → ping).
  const selftestEnv = process.env["SCVN_DESKTOP_SELFTEST"];
  const search = SELFTEST
    ? `selftest=${encodeURIComponent(selftestEnv && selftestEnv !== "1" ? selftestEnv : "ping")}`
    : "";
  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(search ? `${DEV_SERVER_URL}?${search}` : DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(RENDERER_HTML, search ? { search } : undefined);
  }

  const wc = mainWindow.webContents;
  wc.on("did-fail-load", (_e, code, desc, url) => {
    process.stderr.write(`renderer did-fail-load ${code} ${desc} ${url}\n`);
  });
  wc.on("preload-error", (_e, preloadPath, error) => {
    process.stderr.write(`preload-error ${preloadPath}: ${error.message}\n`);
  });
  wc.on("render-process-gone", (_e, details) => {
    process.stderr.write(`render-process-gone: ${details.reason}\n`);
  });
  wc.on("console-message", (event) => {
    process.stderr.write(`renderer console [${event.level}]: ${event.message}\n`);
  });

  // Hardening: this window only ever loads the bundled renderer (or the dev
  // server). Deny renderer-initiated navigation and new windows outright.
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: "deny" }));

  const win = mainWindow;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 200);
  };
  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(win);
  });
  win.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Renderer → host relay.
  ipcMain.on(CHANNEL_TO_HOST, (_event, message: ToHost) => sendToHost(message));

  // Headless self-test report: only wired in self-test mode, so a normal
  // renderer can never trigger app.exit() through this channel.
  if (SELFTEST) {
    ipcMain.on(CHANNEL_SELFTEST, (_event, ok: boolean) => {
      app.exit(ok ? 0 : 1);
    });
  }

  // Session-less native folder/file picker for launch forms.
  ipcMain.handle(
    CHANNEL_PICK_DIR,
    // Branch on multi so each side picks the matching overload (scalar vs
    // array) instead of one broad union crossing the IPC boundary.
    (_event, options: PickOptions & { multi?: boolean }) =>
      options?.multi
        ? openPathDialog({ ...options, multi: true })
        : openPathDialog(options),
  );

  ipcMain.handle(
    CHANNEL_PICK_SAVE,
    (_event, options: SaveOptions | undefined) => savePathDialog(options),
  );

  // Update-channel preference (works in dev too — persists even when the
  // updater itself is inert; the live retune only runs once it's wired).
  ipcMain.handle(CHANNEL_UPDATE_GET_CHANNEL, () => readUpdateChannel());
  ipcMain.on(CHANNEL_UPDATE_SET_CHANNEL, (_event, channel: unknown) => {
    const next: UpdateChannel = channel === "beta" ? "beta" : "stable";
    writeUpdateChannel(next);
    if (autoUpdaterReady) {
      applyUpdateChannel(next);
      autoUpdater.checkForUpdates().catch(() => {});
    }
  });

  spawnHost();
  createWindow();
  setupAutoUpdater();

  // Safety net: if the self-test never reports, fail rather than hang forever.
  if (SELFTEST) {
    setTimeout(() => {
      process.stderr.write("scvn selftest: timed out with no report\n");
      app.exit(1);
    }, 20_000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
