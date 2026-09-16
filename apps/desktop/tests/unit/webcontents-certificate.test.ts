import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { SessionManager } from "../../src/main/session-manager";
import type { ServerProfile } from "../../src/profiles/profile-types";
import { DEFAULT_SETTINGS } from "../../src/shared/settings";

const electronState = vi.hoisted(() => ({
  views: [] as unknown[],
}));

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");

  class FakeWebContents extends EventEmitter {
    readonly session = {};
    readonly navigationHistory = {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    };
    private url = "";
    private readonly loadResolvers: Array<() => void> = [];

    readonly loadURL = vi.fn((url: string) => {
      this.url = url;
      return new Promise<void>((resolve) => this.loadResolvers.push(resolve));
    });
    readonly reload = vi.fn();
    readonly close = vi.fn();

    resolveLoad(index: number): void {
      this.loadResolvers[index]?.();
    }

    isLoading(): boolean {
      return false;
    }

    getURL(): string {
      return this.url;
    }
  }

  class FakeWebContentsView {
    readonly webContents = new FakeWebContents();
    readonly setBounds = vi.fn();

    constructor() {
      electronState.views.push(this);
    }
  }

  return {
    WebContentsView: FakeWebContentsView,
    shell: { openExternal: vi.fn() },
  };
});

vi.mock("../../src/main/security", () => ({
  remoteContentPreferences: () => ({}),
  hardenWebContents: vi.fn(),
}));
vi.mock("../../src/main/navigation-manager", () => ({
  applyRemoteNavigationGuard: () => () => true,
}));
vi.mock("../../src/main/download-manager", () => ({
  installDownloadHandler: vi.fn(),
}));

import { WebContentsManager } from "../../src/main/webcontents-manager";

interface FakeView {
  webContents: {
    loadURL: ReturnType<typeof vi.fn>;
    resolveLoad: (index: number) => void;
    close: ReturnType<typeof vi.fn>;
  };
}

const profile: ServerProfile = {
  id: "certtest01",
  name: "Certificate test",
  protocol: "https",
  host: "10.10.1.28",
  port: 8006,
  connectionMode: "direct",
  certificateMode: "system",
  autoConnect: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function setup() {
  const events: Array<{ event: string; payload: unknown }> = [];
  const manager = new WebContentsManager(
    { getSession: vi.fn() } as unknown as SessionManager,
    () => DEFAULT_SETTINGS,
    (event, payload) => events.push({ event, payload }),
  );
  const contentView = {
    addChildView: vi.fn(),
    removeChildView: vi.fn(),
  };
  manager.attachWindow({ contentView } as unknown as BrowserWindow);
  return { manager, events, contentView };
}

describe("WebContentsManager certificate prompt lifecycle", () => {
  beforeEach(() => {
    electronState.views.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the native view detached during review and starts a fresh load after trust", async () => {
    const { manager, events, contentView } = setup();
    await manager.showServer(profile);
    const view = electronState.views[0] as FakeView;

    expect(view.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(contentView.addChildView).toHaveBeenCalledTimes(1);

    manager.suspendForCertificatePrompt(profile.id);
    expect(contentView.removeChildView).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.some(({ event }) => event === "server:load-error")).toBe(false);

    manager.resumeAfterCertificatePrompt(profile.id, true);
    expect(contentView.addChildView).toHaveBeenCalledTimes(2);
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2);

    view.webContents.resolveLoad(1);
    await Promise.resolve();

    expect(events).toContainEqual({
      event: "server:loaded",
      payload: { profileId: profile.id },
    });

    manager.destroyServer(profile.id);
  });

  it("keeps the view detached and reports a useful error when trust is declined", async () => {
    const { manager, events, contentView } = setup();
    await manager.showServer(profile);

    manager.suspendForCertificatePrompt(profile.id);
    manager.resumeAfterCertificatePrompt(profile.id, false);

    expect(contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(contentView.removeChildView).toHaveBeenCalled();
    expect(events).toContainEqual({
      event: "server:load-error",
      payload: {
        profileId: profile.id,
        message: "The server certificate was not trusted.",
      },
    });

    manager.destroyServer(profile.id);
  });
});
