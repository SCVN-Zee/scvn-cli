/**
 * desktop/main/index.ts — Electron main process: window + IPC broker.
 *
 * Owns the BrowserWindow and a single long-lived utility-process command host.
 * It relays the typed IPC protocol both ways (renderer ⇆ host) and watches the
 * host for exit so a hung/killed host is detected instead of freezing the UI.
 * Native dialogs (folder pickers) are owned here too (wired in Phase 3).
 */

import { app, BrowserWindow, dialog, ipcMain, utilityProcess, type OpenDialogOptions, type UtilityProcess } from "electron";
import path from "node:path";
import os from "node:os";
import type { FromHost, PromptRequestMessage, ToHost, UpdateStatus } from "../shared/ipc.js";
import { loadConfig } from "../../src/config/load.js";
import electronUpdater from "electron-updater";

const CHANNEL_TO_HOST = "scvn:to-host";
const CHANNEL_FROM_HOST = "scvn:from-host";
const CHANNEL_HOST_STATUS = "scvn:host-status";
const CHANNEL_SELFTEST = "scvn:selftest";
const CHANNEL_PICK_DIR = "scvn:pick-dir";
const CHANNEL_UPDATE_STATUS = "scvn:update-status";
const CHANNEL_UPDATE_CHECK = "scvn:update-check";
const CHANNEL_UPDATE_DOWNLOAD = "scvn:update-download";
const CHANNEL_UPDATE_INSTALL = "scvn:update-install";

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
  host = utilityProcess.fork(HOST_ENTRY, [], { serviceName: "scvn-host" });

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

/** Open a native folder/file picker; returns the chosen path or null. */
async function openPathDialog(opts: { kind?: "dir" | "path"; title?: string; defaultPath?: string }): Promise<string | null> {
  const properties: OpenDialogOptions["properties"] =
    opts.kind === "path" ? ["openFile", "openDirectory"] : ["openDirectory"];
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
  return result.canceled ? null : (result.filePaths[0] ?? null);
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
  autoUpdater.on("error", (err) =>
    sendUpdateStatus({ phase: "error", message: err instanceof Error ? err.message : String(err) }),
  );

  // Renderer-driven controls (errors surface via the `error` event above).
  ipcMain.on(CHANNEL_UPDATE_CHECK, () => {
    autoUpdater.checkForUpdates().catch(() => {});
  });
  ipcMain.on(CHANNEL_UPDATE_DOWNLOAD, () => {
    autoUpdater.downloadUpdate().catch(() => {});
  });
  ipcMain.on(CHANNEL_UPDATE_INSTALL, () => autoUpdater.quitAndInstall());
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 600,
    minHeight: 560,
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

  mainWindow.on("closed", () => {
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
    (_event, options: { kind?: "dir" | "path"; title?: string; defaultPath?: string }) =>
      openPathDialog(options ?? {}),
  );

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
