/**
 * WebContentsView manager (spec §6, §12, §42).
 *
 * Renders the real Proxmox web interface using Electron WebContentsView (never
 * an <iframe> or <webview> tag). One view per server, each bound to that
 * server's isolated session. The view occupies only the content workspace and
 * is repositioned as the window resizes. Handles browser-style controls and
 * crash recovery.
 */

import { WebContentsView, shell, type BrowserWindow } from "electron";
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

/**
 * How long to wait for a server's initial page to finish loading before
 * treating it as unreachable. A blank/hung page must never leave the user
 * staring at an empty view with no feedback (spec §6.6 crash/recovery intent).
 */
const LOAD_TIMEOUT_MS = 25_000;

export class WebContentsManager {
  private readonly views = new Map<string, WebContentsView>();
  /** Per-server watchdog timers for the initial/reconnect load. */
  private readonly loadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Monotonic token per server so a stale load's late result is ignored. */
  private readonly loadToken = new Map<string, number>();
  /** Last requested URL, retained so certificate approval can start a fresh load. */
  private readonly loadUrl = new Map<string, string>();
  /** Views that must perform a fresh load the next time they are shown. */
  private readonly needsReload = new Set<string>();
  /** Loads paused while the user reviews a certificate prompt. */
  private readonly certificateSuspended = new Set<string>();
  /** Certificate-prompt views that were visible before being detached. */
  private readonly certificatePromptWasActive = new Set<string>();
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

    // A main-frame load failed on a navigation NOT initiated by beginLoad
    // (e.g. an in-page link or a user reload). beginLoad-driven loads are
    // resolved by the loadURL promise instead, so we skip those here (guarded
    // by an in-flight watchdog timer) to avoid double-handling. Chromium also
    // fires did-fail-load then renders its own error page — detaching the view
    // keeps the native retry overlay visible and clickable underneath.
    wc.on("did-fail-load", (_e, errorCode, errorDescription, _url, isMainFrame) => {
      // ERR_ABORTED (-3) is a normal side effect of redirects/reloads.
      if (!isMainFrame || errorCode === -3) return;
      // A certificate decision deliberately pauses this navigation. Its stale
      // failure is ignored because the decision handler starts a fresh load.
      if (this.certificateSuspended.has(profile.id)) return;
      if (this.loadTimers.has(profile.id)) return; // handled by beginLoad's promise
      logger.warn({
        module: "webcontents",
        event: "did-fail-load",
        serverProfileId: profile.id,
        detail: { errorCode, errorDescription },
      });
      this.failLoad(profile.id, `${errorDescription} (${errorCode})`);
    });

    wc.on("render-process-gone", (_e, details) => {
      logger.error({
        module: "webcontents",
        event: "render-process-gone",
        serverProfileId: profile.id,
        detail: { reason: details.reason },
      });
      // Crash recovery: surface a reconnect screen, keep the profile/pin.
      // Detach the dead view so the crash overlay underneath is interactive.
      this.clearLoadTimer(profile.id);
      this.needsReload.add(profile.id);
      this.detach(profile.id);
      this.emit("server:crashed", { profileId: profile.id, reason: details.reason });
    });

    this.views.set(profile.id, view);
    return view;
  }

  private clearLoadTimer(profileId: string): void {
    const t = this.loadTimers.get(profileId);
    if (t) {
      clearTimeout(t);
      this.loadTimers.delete(profileId);
    }
  }

  private armLoadTimer(profileId: string, token: number): void {
    if (this.certificateSuspended.has(profileId)) return;

    this.clearLoadTimer(profileId);
    this.loadTimers.set(
      profileId,
      setTimeout(() => {
        if (this.loadToken.get(profileId) !== token) return;
        this.loadToken.set(profileId, token + 1); // ignore a late loadURL result
        logger.warn({ module: "webcontents", event: "load-timeout", serverProfileId: profileId });
        this.failLoad(profileId, "Timed out waiting for the server to respond.");
      }, LOAD_TIMEOUT_MS),
    );
  }

  /** Attach an existing server view and make it the active native child view. */
  private attach(profileId: string): void {
    const view = this.views.get(profileId);
    if (!view || !this.win) return;

    if (this.activeId && this.activeId !== profileId) {
      const previous = this.views.get(this.activeId);
      if (previous) this.win.contentView.removeChildView(previous);
    }

    this.win.contentView.addChildView(view);
    view.setBounds(this.bounds);
    this.activeId = profileId;
  }

  /** Remove a server's view from the window without destroying it. */
  private detach(profileId: string): void {
    const view = this.views.get(profileId);
    if (view && this.win) this.win.contentView.removeChildView(view);
    if (this.activeId === profileId) this.activeId = null;
  }

  /** Mark a server's load as failed: detach the blank view and notify the UI. */
  private failLoad(profileId: string, message: string): void {
    this.clearLoadTimer(profileId);
    this.certificateSuspended.delete(profileId);
    this.certificatePromptWasActive.delete(profileId);
    this.needsReload.add(profileId);
    this.detach(profileId);
    this.emit("server:load-error", { profileId, message });
  }

  /**
   * Hide the native child view while the renderer displays certificate details.
   * Native child views always render above the BrowserWindow DOM, regardless of
   * CSS z-index. The watchdog is paused so human review time is not a timeout.
   */
  suspendForCertificatePrompt(profileId: string): void {
    this.certificateSuspended.add(profileId);
    this.clearLoadTimer(profileId);
    if (this.activeId === profileId) {
      this.certificatePromptWasActive.add(profileId);
      this.detach(profileId);
    }
  }

  /**
   * Complete certificate review. The original Chromium navigation can expire
   * while the user reads the prompt, so invalidate it and always start a fresh
   * load after trust has actually been stored and Electron has the verdict.
   */
  resumeAfterCertificatePrompt(profileId: string, accepted: boolean): void {
    if (!this.certificateSuspended.delete(profileId)) return;

    const wasActive = this.certificatePromptWasActive.delete(profileId);
    const token = this.loadToken.get(profileId);
    if (token !== undefined) this.loadToken.set(profileId, token + 1);

    if (!accepted) {
      this.failLoad(profileId, "The server certificate was not trusted.");
      return;
    }

    if (wasActive && !this.activeId) this.attach(profileId);
    const url = this.loadUrl.get(profileId);
    if (url) this.beginLoad(profileId, url);
  }

  /**
   * Load a URL into a server's view under a watchdog. The loadURL promise is
   * the authoritative signal: it resolves once the page finishes loading and
   * rejects on a network/TLS failure (Chromium's did-finish-load fires even for
   * its own error page, so it cannot be trusted for success). If the page never
   * settles, the watchdog detaches the view and surfaces a timeout so the user
   * is never stranded on a blank screen.
   */
  private beginLoad(profileId: string, url: string): void {
    const view = this.views.get(profileId);
    if (!view) return;

    const token = (this.loadToken.get(profileId) ?? 0) + 1;
    this.loadToken.set(profileId, token);
    this.loadUrl.set(profileId, url);
    const isCurrent = (): boolean => this.loadToken.get(profileId) === token;

    this.needsReload.delete(profileId);
    this.emit("server:status", { profileId, status: "connecting" });
    this.armLoadTimer(profileId, token);

    view.webContents.loadURL(url).then(
      () => {
        if (!isCurrent()) return;
        this.clearLoadTimer(profileId);
        this.emit("server:loaded", { profileId });
      },
      (err: unknown) => {
        if (!isCurrent() || this.certificateSuspended.has(profileId)) return;
        this.failLoad(profileId, (err as Error).message);
      },
    );
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

    let view = this.views.get(profile.id);
    const isNew = !view;
    if (!view) view = this.createView(profile);

    this.attach(profile.id);

    if (isNew || this.needsReload.has(profile.id)) {
      const url = buildBaseUrl(profile.protocol, profile.host, profile.port);
      logger.info({
        module: "webcontents",
        event: "load-server",
        serverProfileId: profile.id,
      });
      this.beginLoad(profile.id, url);
    }
  }

  /** Hide the embedded browser so the native UI (home/dashboard) shows. */
  hideActive(): void {
    if (this.activeId) this.detach(this.activeId);
    // If navigation leaves the workspace while a prompt is visible, accepting
    // it later must not unexpectedly place the native view over another page.
    this.certificatePromptWasActive.clear();
    this.activeId = null;
  }

  /** Open the server's Proxmox UI in the user's default system browser. */
  openExternal(profile: ServerProfile): void {
    const url = buildBaseUrl(profile.protocol, profile.host, profile.port);
    logger.info({ module: "webcontents", event: "open-external", serverProfileId: profile.id });
    void shell.openExternal(url);
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

  /** Reconnect: re-attach the view (it may have been detached after a failed
   * load or crash) and reload the base server URL from scratch. */
  async reconnect(profile: ServerProfile): Promise<void> {
    if (!this.views.get(profile.id)) {
      // No view yet: a fresh showServer creates it and starts the load.
      await this.showServer(profile);
      return;
    }
    // Ensure the (possibly detached) view is shown again before reloading.
    this.attach(profile.id);
    const url = buildBaseUrl(profile.protocol, profile.host, profile.port);
    this.beginLoad(profile.id, url);
  }

  destroyServer(profileId: string): void {
    this.clearLoadTimer(profileId);
    this.loadToken.delete(profileId);
    this.loadUrl.delete(profileId);
    this.needsReload.delete(profileId);
    this.certificateSuspended.delete(profileId);
    this.certificatePromptWasActive.delete(profileId);
    const view = this.views.get(profileId);
    if (!view) return;
    if (this.win) this.win.contentView.removeChildView(view);
    // Close the underlying webContents to release the process.
    (view.webContents as unknown as { close?: () => void }).close?.();
    this.views.delete(profileId);
    if (this.activeId === profileId) this.activeId = null;
  }
}
