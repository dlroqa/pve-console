/**
 * Navigation restrictions (spec §6.4, §41).
 *
 * Remote Proxmox content may navigate only within the trusted origin(s) of the
 * active server profile. Same-origin links stay in the view; external origins
 * open in the system browser (or are blocked). The native application shell may
 * never be navigated to an arbitrary remote origin.
 */

import { shell, type WebContents } from "electron";
import { buildBaseUrl } from "../shared/validation";
import { logger } from "../shared/logger";
import type { ServerProfile } from "../profiles/profile-types";

/** The set of origins considered trusted for a given server profile. */
export function trustedOriginsFor(profile: ServerProfile): Set<string> {
  const origins = new Set<string>();
  try {
    origins.add(new URL(buildBaseUrl(profile.protocol, profile.host, profile.port)).origin);
  } catch {
    /* ignore malformed */
  }
  return origins;
}

export function isSameOrigin(url: string, origins: Set<string>): boolean {
  try {
    return origins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Constrain an embedded Proxmox WebContents to the profile's trusted origins.
 * Returns a predicate usable by the window-open handler.
 */
export function applyRemoteNavigationGuard(
  webContents: WebContents,
  profile: ServerProfile,
  openExternally: (url: string) => void = (u) => void shell.openExternal(u),
): (url: string) => boolean {
  const origins = trustedOriginsFor(profile);
  const isAllowed = (url: string) => isSameOrigin(url, origins);

  webContents.on("will-navigate", (event, url) => {
    if (!isAllowed(url)) {
      event.preventDefault();
      openExternally(url);
      logger.info({
        module: "navigation",
        event: "blocked-remote-navigation",
        serverProfileId: profile.id,
        detail: { url },
      });
    }
  });

  webContents.on("will-redirect", (event, url) => {
    if (!isAllowed(url)) {
      event.preventDefault();
      logger.warn({
        module: "navigation",
        event: "blocked-redirect",
        serverProfileId: profile.id,
        detail: { url },
      });
    }
  });

  return isAllowed;
}

/**
 * Lock the native application shell to its own local origin. It must never
 * navigate to a remote origin (spec §2.4 acceptance).
 */
export function applyShellNavigationGuard(
  webContents: WebContents,
  allowedShellUrl: string,
): void {
  let allowedOrigin = "";
  try {
    allowedOrigin = new URL(allowedShellUrl).origin;
  } catch {
    /* file:// URLs have a null origin; handled below. */
  }

  const isShellUrl = (url: string): boolean => {
    if (url.startsWith("file://")) return true; // packaged renderer
    if (url === "about:blank") return true;
    try {
      return allowedOrigin !== "" && new URL(url).origin === allowedOrigin;
    } catch {
      return false;
    }
  };

  webContents.on("will-navigate", (event, url) => {
    if (!isShellUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
      logger.warn({ module: "navigation", event: "blocked-shell-navigation", detail: { url } });
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}
