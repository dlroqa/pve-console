/**
 * Window manager (spec §1.4, §2.1).
 *
 * Creates the single native application BrowserWindow with hardened
 * webPreferences, attaches the restricted preload, applies a Content Security
 * Policy, and locks the shell to its own origin.
 */

import { app, BrowserWindow, session } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME } from "../shared/constants";
import { nativeWindowPreferences } from "./security";
import { applyShellNavigationGuard } from "./navigation-manager";
import { logger } from "../shared/logger";

const DEV_URL = "http://localhost:5173";

function isDev(): boolean {
  return process.env.NODE_ENV === "development";
}

/** Apply a CSP to the native shell documents only. */
function applyShellCsp(): void {
  const dev = isDev();
  // Dev needs the Vite websocket + eval for HMR; production is strict.
  const csp = dev
    ? "default-src 'self' 'unsafe-inline' data:; connect-src 'self' ws://localhost:5173 http://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data:;"
    : "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only apply to the shell's own documents (localhost/file), not remote
    // Proxmox content (which lives in isolated sessions, not defaultSession).
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

export function createMainWindow(): BrowserWindow {
  applyShellCsp();

  const preloadPath = join(__dirname, "preload.js");
  // Bundled app icon (assets/icon.png ships inside the app; see electron-builder
  // `files`). On macOS the dock uses the packaged bundle icon instead.
  const iconPath = join(app.getAppPath(), "assets", "icon.png");
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: "#0f1115",
    show: false,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: nativeWindowPreferences(preloadPath),
  });

  applyShellNavigationGuard(win.webContents, isDev() ? DEV_URL : "file://");

  win.once("ready-to-show", () => win.show());

  if (isDev()) {
    void win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  logger.info({ module: "window", event: "main-window-created" });
  return win;
}
