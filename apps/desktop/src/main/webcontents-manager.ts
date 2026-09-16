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
  /** Token for a navigation started explicitly through webContents.loadURL. */
  private readonly managedLoadToken = new Map<string, number>();
  /** Current token whose main-frame navigation has failed. */
  private readonly failedLoadToken = new Map<string, number>();
  /** Current token already reported as connected. */
  private readonly completedLoadToken = new Map<string, number>();
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
    // Same-document Proxmox hash navigation must not reset connection status:
    // it can emit did-start-loading without a matching did-finish-load.
    // Only main-frame, non-in-place navigation starts a status lifecycle.
    wc.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
      const currentToken = this.loadToken.get(profile.id);
      if (
        currentToken !== undefined &&
        isMainFrame &&
        !isInPlace &&
        isAllowed(url) &&
        !this.loadTimers.has(profile.id) &&
        !this.certificateSuspended.has(profile.id)
      ) {
        const token = currentToken + 1;
        this.loadToken.set(profile.id, token);
        this.managedLoadToken.delete(profile.id);
        this.failedLoadToken.delete(profile.id);
        this.completedLoadToken.delete(profile.id);
        this.emit("server:status", { profileId: profile.id, status: "connecting" });
        this.armLoadTimer(profile.id, token);
      }
    });
    wc.on("did-stop-loading", () => this.emitNav(profile.id, wc));
    wc.on("did-navigate", () => this.emitNav(profile.id, wc));
    wc.on("did-navigate-in-page", () => this.emitNav(profile.id, wc));
    wc.on("did-finish-load", () => {
      const token = this.loadToken.get(profile.id);
      if (token === undefined || !isAllowed(wc.getURL())) return;
      this.completeLoad(profile.id, token);
    });

    // Chromium can render its own error page after did-fail-load. Record the
    // failure against the current token so did-finish-load cannot misclassify
    // that error document as a successful server connection.
    wc.on("did-fail-load", (_e, errorCode, errorDescription, _url, isMainFrame) => {
      // ERR_ABORTED (-3) is a normal side effect of redirects/reloads.
      if (!isMainFrame || errorCode === -3) return;
      const token = this.loadToken.get(profile.id);
      if (token !== undefined) this.failedLoadToken.set(profile.id, token);
      // A certificate decision deliberately pauses this navigation. Its stale
      // failure is ignored because the decision handler starts a fresh load.
      if (this.certificateSuspended.has(profile.id)) return;
      // A beginLoad navigation is handled by its loadURL rejection. Other
      // navigations fail immediately rather than waiting for the watchdog.
      if (token !== undefined && this.managedLoadToken.get(profile.id) === token) return;
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

  private completeLoad(profileId: string, token: number): void {
    if (
      this.loadToken.get(profileId) !== token ||
      this.certificateSuspended.has(profileId) ||
      this.failedLoadToken.get(profileId) === token ||
      this.completedLoadToken.get(profileId) === token
    ) {
      return;
    }
    this.clearLoadTimer(profileId);
    if (this.managedLoadToken.get(profileId) === token) this.managedLoadToken.delete(profileId);
    this.completedLoadToken.set(profileId, token);
    this.emit("server:loaded", { profileId });
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
    this.managedLoadToken.delete(profileId);
    this.completedLoadToken.delete(profileId);
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
   * Load a URL into a server's view under a watchdog. Success can arrive from
   * either the loadURL promise or a validated same-origin did-finish-load event;
   * Proxmox may be interactive before Electron settles the promise. Failures are
   * tokened so Chromium's generated error page cannot report a false connection.
   * If neither signal settles, the watchdog surfaces a timeout.
   */
  private beginLoad(profileId: string, url: string): void {
    const view = this.views.get(profileId);
    if (!view) return;

    const token = (this.loadToken.get(profileId) ?? 0) + 1;
    this.loadToken.set(profileId, token);
    this.loadUrl.set(profileId, url);
    this.managedLoadToken.set(profileId, token);
    this.failedLoadToken.delete(profileId);
    this.completedLoadToken.delete(profileId);
    const isCurrent = (): boolean => this.loadToken.get(profileId) === token;

    this.needsReload.delete(profileId);
    this.emit("server:status", { profileId, status: "connecting" });
    this.armLoadTimer(profileId, token);

    view.webContents.loadURL(url).then(
      () => {
        if (!isCurrent()) return;
        this.completeLoad(profileId, token);
      },
      (err: unknown) => {
        if (!isCurrent() || this.certificateSuspended.has(profileId) || this.completedLoadToken.get(profileId) === token) return;
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
    this.managedLoadToken.delete(profileId);
    this.failedLoadToken.delete(profileId);
    this.completedLoadToken.delete(profileId);
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
