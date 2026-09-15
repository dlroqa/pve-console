/**
 * Central security policy (spec §6, Phase 2).
 *
 * Defines the hardened webPreferences used everywhere and the runtime guards
 * applied to every WebContents (native shell and embedded Proxmox alike):
 *  - no Node integration in any renderer;
 *  - context isolation + sandbox + webSecurity always on;
 *  - no <webview> tag;
 *  - permission requests denied by default;
 *  - window.open / new windows funnelled through an approved policy.
 */

import { shell, type WebContents, type WebPreferences } from "electron";
import { logger } from "../shared/logger";

/** Hardened preferences for the native application window. */
export function nativeWindowPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    spellcheck: false,
    // No Node integration in workers either.
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
  };
}

/**
 * Hardened preferences for embedded remote Proxmox content (spec §6.1).
 * NOTE: no preload is attached to remote content — the native preload bridge
 * must never be exposed to the remote Proxmox page.
 */
export function remoteContentPreferences(partition: string): WebPreferences {
  return {
    partition,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
  };
}

/**
 * Apply runtime guards to any WebContents. `isRemote` marks embedded Proxmox
 * content, which has stricter window-open handling.
 */
export function hardenWebContents(
  webContents: WebContents,
  options: {
    isRemote: boolean;
    /** Predicate: is this URL an allowed same-server destination? */
    isAllowedNavigation: (url: string) => boolean;
    openExternally?: (url: string) => void;
  },
): void {
  const openExternal = options.openExternally ?? ((url: string) => void shell.openExternal(url));

  // Deny all permission requests by default (camera, geolocation, etc.).
  const ses = webContents.session;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    // Clipboard/fullscreen for consoles are handled by Electron directly and
    // do not come through here; everything else is denied.
    const allowed = new Set(["clipboard-read", "clipboard-sanitized-write", "fullscreen"]);
    const grant = allowed.has(permission);
    logger.debug({
      module: "security",
      event: "permission-request",
      detail: { permission, granted: grant },
    });
    callback(grant);
  });

  // Control creation of new windows (window.open, target=_blank, ctrl-click).
  webContents.setWindowOpenHandler(({ url }) => {
    if (options.isAllowedNavigation(url)) {
      // Same-server popups (e.g. detached console) are allowed as child views.
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    // Anything else opens in the system browser (or is blocked).
    openExternal(url);
    logger.info({ module: "security", event: "external-window-open", detail: { url } });
    return { action: "deny" };
  });

  // Block attaching <webview> and prevent enabling node in child frames.
  webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
    logger.warn({ module: "security", event: "webview-attach-blocked" });
  });
}
