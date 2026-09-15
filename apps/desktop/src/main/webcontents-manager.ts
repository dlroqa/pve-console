/**
 * WebContentsView manager (spec §6, §12, §42).
 *
 * Renders the real Proxmox web interface using Electron WebContentsView (never
 * an <iframe> or <webview> tag). One view per server, each bound to that
 * server's isolated session. The view occupies only the content workspace and
 * is repositioned as the window resizes. Handles browser-style controls and
 * crash recovery.
 */

import { WebContentsView, type BrowserWindow } from "electron";
import { sessionPartitionFor } from "../shared/constants";
import { buildBaseUrl } from "../shared/validation";
import { remoteContentPreferences, hardenWebContents } from "./security";
import { applyRemoteNavigationGuard } from "./navigation-manager";
import { installDownloadHandler } from "./download-manager";
import { logger } from "../shared/logger";
import type { SessionManager } from "./session-manager";
import type { ServerProfile } from "../profiles/profile-types";
import type { AppSettings } from "../shared/types";

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  url: string;
}

export class WebContentsManager {
  private readonly views = new Map<string, WebContentsView>();
  private win: BrowserWindow | null = null;
  private activeId: string | null = null;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly sessions: SessionManager,
    private readonly getSettings: () => AppSettings,
    private readonly emit: (event: string, payload: unknown) => void,
  ) {}

  attachWindow(win: BrowserWindow): void {
    this.win = win;
  }

  setContentBounds(bounds: ContentBounds): void {
    this.bounds = bounds;
    if (this.activeId) {
      const view = this.views.get(this.activeId);
      view?.setBounds(bounds);
    }
  }

  private createView(profile: ServerProfile): WebContentsView {
    // Ensure the isolated session (and its certificate verify proc) exists.
    this.sessions.getSession(profile);
    const partition = sessionPartitionFor(profile.id);

    const view = new WebContentsView({
      webPreferences: remoteContentPreferences(partition),
    });
    const wc = view.webContents;

    const isAllowed = applyRemoteNavigationGuard(wc, profile);
    hardenWebContents(wc, { isRemote: true, isAllowedNavigation: isAllowed });
    installDownloadHandler(wc.session, profile.id, this.getSettings);

    wc.on("did-start-loading", () => this.emitNav(profile.id, wc));
    wc.on("did-stop-loading", () => this.emitNav(profile.id, wc));
    wc.on("did-navigate", () => this.emitNav(profile.id, wc));
    wc.on("did-navigate-in-page", () => this.emitNav(profile.id, wc));

    wc.on("render-process-gone", (_e, details) => {
      logger.error({
        module: "webcontents",
        event: "render-process-gone",
        serverProfileId: profile.id,
        detail: { reason: details.reason },
      });
      // Crash recovery: surface a reconnect screen, keep the profile/pin.
      this.emit("server:crashed", { profileId: profile.id, reason: details.reason });
    });

    this.views.set(profile.id, view);
    return view;
  }

  private emitNav(profileId: string, wc: Electron.WebContents): void {
    const state: NavigationState = {
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      isLoading: wc.isLoading(),
      url: wc.getURL(),
    };
    this.emit("server:navigation", { profileId, state });
  }

  /** Show the given server's Proxmox view in the content workspace. */
  async showServer(profile: ServerProfile): Promise<void> {
    if (!this.win) throw new Error("Main window not attached.");

    // Detach the currently active view (if different).
    if (this.activeId && this.activeId !== profile.id) {
      const prev = this.views.get(this.activeId);
      if (prev) this.win.contentView.removeChildView(prev);
    }

    let view = this.views.get(profile.id);
    const isNew = !view;
    if (!view) view = this.createView(profile);

    this.win.contentView.addChildView(view);
    view.setBounds(this.bounds);
    this.activeId = profile.id;

    if (isNew) {
      const url = buildBaseUrl(profile.protocol, profile.host, profile.port);
      logger.info({
        module: "webcontents",
        event: "load-server",
        serverProfileId: profile.id,
      });
      await view.webContents.loadURL(url).catch((err) => {
        logger.warn({
          module: "webcontents",
          event: "load-failed",
          serverProfileId: profile.id,
          detail: { message: (err as Error).message },
        });
        this.emit("server:load-error", { profileId: profile.id, message: (err as Error).message });
      });
    }
  }

  /** Hide the embedded browser so the native UI (home/dashboard) shows. */
  hideActive(): void {
    if (this.win && this.activeId) {
      const view = this.views.get(this.activeId);
      if (view) this.win.contentView.removeChildView(view);
    }
    this.activeId = null;
  }

  private active(): WebContentsView | undefined {
    return this.activeId ? this.views.get(this.activeId) : undefined;
  }

  back(): void {
    const wc = this.active()?.webContents;
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.active()?.webContents;
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.active()?.webContents.reload();
  }

  /** Reconnect: reload the base server URL from scratch. */
  async reconnect(profile: ServerProfile): Promise<void> {
    const view = this.views.get(profile.id);
    if (!view) {
      await this.showServer(profile);
      return;
    }
    const url = buildBaseUrl(profile.protocol, profile.host, profile.port);
    await view.webContents.loadURL(url).catch(() => undefined);
  }

  destroyServer(profileId: string): void {
    const view = this.views.get(profileId);
    if (!view) return;
    if (this.win) this.win.contentView.removeChildView(view);
    // Close the underlying webContents to release the process.
    (view.webContents as unknown as { close?: () => void }).close?.();
    this.views.delete(profileId);
    if (this.activeId === profileId) this.activeId = null;
  }
}
