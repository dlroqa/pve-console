/**
 * Electron main process entry point (spec §5, §46).
 *
 * Boots the hardened native window, wires the trusted managers (profiles,
 * certificates, sessions, embedded browser) and registers the IPC allowlist.
 */

import { app, BrowserWindow } from "electron";
import { APP_ID, APP_NAME } from "../shared/constants";
import { logger, setLogLevel } from "../shared/logger";
import { normalizeSettings, DEFAULT_SETTINGS } from "../shared/settings";
import { ConfigStore } from "../storage/config-store";
import { ProfileManager } from "../profiles/profile-manager";
import { CertificateManager } from "../certificates/certificate-manager";
import { SessionManager } from "./session-manager";
import { WebContentsManager } from "./webcontents-manager";
import { createMainWindow } from "./window-manager";
import {
  registerIpcHandlers,
  applyRuntimeSettings,
  CertificatePromptBridge,
  type AppServices,
} from "./ipc";
import type { AppSettings } from "../shared/types";

const SETTINGS_FILE = "settings";

// Single-instance lock so isolated sessions and pins are never contended.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

let mainWindow: BrowserWindow | null = null;

async function bootstrap(): Promise<void> {
  const configStore = new ConfigStore(app.getPath("userData"));

  // Load + apply settings.
  let settings: AppSettings = normalizeSettings(
    await configStore.readJson(SETTINGS_FILE, DEFAULT_SETTINGS),
  );
  setLogLevel(settings.logLevel);

  const getSettings = () => settings;
  const setSettings = async (next: AppSettings): Promise<AppSettings> => {
    settings = next;
    await configStore.writeJson(SETTINGS_FILE, settings);
    applyRuntimeSettings(settings);
    return settings;
  };

  const profiles = new ProfileManager(configStore);
  const certificates = new CertificateManager(configStore);
  const promptBridge = new CertificatePromptBridge();

  const emit = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  const sessions = new SessionManager(certificates, promptBridge.prompt, (profileId, warning) => {
    if (warning) emit("server:status", { profileId, status: "certificate-warning" });
  });

  const webContents = new WebContentsManager(sessions, getSettings, emit);

  const services: AppServices = {
    profiles,
    certificates,
    sessions,
    webContents,
    promptBridge,
    getSettings,
    setSettings,
  };

  registerIpcHandlers(services);

  mainWindow = createMainWindow();
  promptBridge.setWindow(mainWindow);
  webContents.attachWindow(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  logger.info({ module: "main", event: "bootstrap-complete" });
}

app.whenReady().then(bootstrap).catch((err) => {
  logger.error({ module: "main", event: "bootstrap-failed", detail: { message: (err as Error).message } });
  app.quit();
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void bootstrap();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Defense in depth: block creation of any window not created by our managers.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
});
