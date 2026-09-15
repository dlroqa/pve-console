/**
 * IPC layer (spec §6.2, Phase 2).
 *
 * Registers handlers ONLY for the allowlisted channels (shared/ipc-channels.ts).
 * Any channel not on the list is never handled. Every handler is wrapped so it
 * returns a structured IpcResult and never leaks stack traces unless developer
 * diagnostics are enabled.
 */

import { ipcMain, dialog, app, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { INVOKE_CHANNELS, type InvokeChannel } from "../shared/ipc-channels";
import { ErrorCode, type AppError, type AppSettings, type IpcResult } from "../shared/types";
import { APP_NAME } from "../shared/constants";
import { logger, setLogLevel } from "../shared/logger";
import { normalizeSettings } from "../shared/settings";
import { runDiagnostics } from "../diagnostics/diagnostics-engine";
import { ProfileValidationError } from "../profiles/profile-schema";
import { ProxmoxApiError } from "../proxmox/client";
import type { ProfileManager } from "../profiles/profile-manager";
import type { CertificateManager } from "../certificates/certificate-manager";
import type { CertificateDecision, CertificateEvaluation } from "../certificates/certificate-types";
import type { SessionManager, CertificatePrompt } from "./session-manager";
import type { WebContentsManager, ContentBounds } from "./webcontents-manager";
import type { ServerProfile } from "../profiles/profile-types";
import type { ProxmoxService } from "../proxmox/proxmox-service";
import type { GuestType } from "../proxmox/guest-actions";

/**
 * Bridges an async certificate decision from the renderer back to the
 * SessionManager's verify procedure.
 */
export class CertificatePromptBridge {
  private win: BrowserWindow | null = null;
  private readonly pending = new Map<string, (d: CertificateDecision) => void>();

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  readonly prompt: CertificatePrompt = ({ profile, evaluation }) => {
    return new Promise<CertificateDecision>((resolve) => {
      const requestId = randomUUID();
      this.pending.set(requestId, resolve);
      const payload = buildPromptPayload(requestId, profile, evaluation);
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.send("certificate:prompt", payload);
      } else {
        // No window to ask — fail safe by cancelling.
        this.pending.delete(requestId);
        resolve("cancel");
      }
    });
  };

  resolve(requestId: string, decision: CertificateDecision): void {
    const r = this.pending.get(requestId);
    if (r) {
      this.pending.delete(requestId);
      r(decision);
    }
  }
}

function buildPromptPayload(
  requestId: string,
  profile: ServerProfile,
  evaluation: Extract<CertificateEvaluation, { status: "unknown" } | { status: "mismatch" }>,
) {
  return {
    requestId,
    profileId: profile.id,
    profileName: profile.name,
    host: profile.host,
    port: profile.port,
    status: evaluation.status,
    observed: evaluation.observed,
    previousFingerprint:
      evaluation.status === "mismatch" ? evaluation.previousFingerprint : undefined,
  };
}

export interface AppServices {
  profiles: ProfileManager;
  certificates: CertificateManager;
  sessions: SessionManager;
  webContents: WebContentsManager;
  promptBridge: CertificatePromptBridge;
  proxmox: ProxmoxService;
  getSettings: () => AppSettings;
  setSettings: (s: AppSettings) => Promise<AppSettings>;
}

function toAppError(err: unknown, devDiagnostics: boolean): AppError {
  if (err instanceof ProfileValidationError) {
    return { code: ErrorCode.PROFILE_ERROR, message: err.message };
  }
  if (err instanceof ProxmoxApiError) {
    return err.appError;
  }
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: devDiagnostics ? message : "An unexpected error occurred.",
    detail: devDiagnostics && err instanceof Error ? err.stack : undefined,
  };
}

/** Register a handler with uniform error wrapping. */
function handle<T>(
  channel: InvokeChannel,
  services: AppServices,
  fn: (...args: unknown[]) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      const value = await fn(...args);
      return { ok: true, value };
    } catch (err) {
      const devDiagnostics = services.getSettings().enableDeveloperDiagnostics;
      logger.error({
        module: "ipc",
        event: "handler-error",
        detail: { channel, message: err instanceof Error ? err.message : String(err) },
      });
      return { ok: false, error: toAppError(err, devDiagnostics) };
    }
  });
}

async function requireProfile(services: AppServices, id: unknown): Promise<ServerProfile> {
  if (typeof id !== "string") throw new ProfileValidationError("Profile id is required.");
  const profile = await services.profiles.get(id);
  if (!profile) throw new ProfileValidationError(`No profile with id "${id}".`);
  return profile;
}

export function registerIpcHandlers(services: AppServices): void {
  // ---- Profiles (Phase 3) ----
  handle("profiles:list", services, () => services.profiles.list());
  handle("profiles:get", services, (id) => services.profiles.get(String(id)));
  handle("profiles:create", services, (input) => services.profiles.create(input as never));
  handle("profiles:update", services, (id, patch) =>
    services.profiles.update(String(id), patch as never),
  );
  handle("profiles:delete", services, async (id) => {
    await services.profiles.delete(String(id));
    await services.certificates.removePinForProfile(String(id));
    services.webContents.destroyServer(String(id));
    return true;
  });

  // ---- Embedded browser / server (Phase 6, 8) ----
  handle("server:connect", services, async (id) => {
    const profile = await requireProfile(services, id);
    await services.webContents.showServer(profile);
    return true;
  });
  handle("server:disconnect", services, async (id) => {
    services.webContents.destroyServer(String(id));
    return true;
  });
  handle("server:reload", services, () => {
    services.webContents.reload();
    return true;
  });
  handle("server:back", services, () => {
    services.webContents.back();
    return true;
  });
  handle("server:forward", services, () => {
    services.webContents.forward();
    return true;
  });
  handle("server:reconnect", services, async (id) => {
    const profile = await requireProfile(services, id);
    await services.webContents.reconnect(profile);
    return true;
  });
  handle("server:showNative", services, () => {
    services.webContents.hideActive();
    return true;
  });
  handle("server:setContentBounds", services, (bounds) => {
    services.webContents.setContentBounds(bounds as ContentBounds);
    return true;
  });
  handle("server:clearSession", services, async (id) => {
    await services.sessions.clearSession(String(id));
    return true;
  });

  // ---- Diagnostics (Phase 4) ----
  handle("diagnostics:run", services, (target) => runDiagnostics(target as never));

  // ---- Certificates (Phase 5) ----
  handle("certificate:list", services, () => services.certificates.listPins());
  handle("certificate:respond", services, (requestId, decision) => {
    services.promptBridge.resolve(String(requestId), decision as CertificateDecision);
    return true;
  });

  // ---- Settings (Phase 2 / §23) ----
  handle("settings:get", services, () => services.getSettings());
  handle("settings:set", services, (settings) => services.setSettings(normalizeSettings(settings)));

  // ---- Native Proxmox API (Phase 9, Version 2) ----
  // These are read-only and isolated from the embedded browser: any failure
  // here surfaces as a structured error and never disturbs browser mode.
  handle("proxmox:getTokenStatus", services, (id) => services.proxmox.getTokenStatus(String(id)));
  handle("proxmox:setToken", services, async (id, tokenName, tokenSecret) => {
    await services.proxmox.setToken(String(id), String(tokenName), String(tokenSecret));
    return true;
  });
  handle("proxmox:removeToken", services, async (id) => {
    await services.proxmox.removeToken(String(id));
    return true;
  });
  handle("proxmox:verifyToken", services, (id) => services.proxmox.verify(String(id)));
  handle("proxmox:getSummary", services, (id) => services.proxmox.getSummary(String(id)));
  handle("proxmox:getNodes", services, (id) => services.proxmox.getNodes(String(id)));
  handle("proxmox:getGuests", services, (id) => services.proxmox.getGuests(String(id)));

  // Native VM/LXC controls (Phase 11). The renderer confirms destructive
  // actions (stop) before invoking; the main process performs the API call.
  handle("proxmox:startGuest", services, (id, node, type, vmid) =>
    services.proxmox.startGuest(String(id), String(node), type as GuestType, Number(vmid)),
  );
  handle("proxmox:shutdownGuest", services, (id, node, type, vmid) =>
    services.proxmox.shutdownGuest(String(id), String(node), type as GuestType, Number(vmid)),
  );
  handle("proxmox:rebootGuest", services, (id, node, type, vmid) =>
    services.proxmox.rebootGuest(String(id), String(node), type as GuestType, Number(vmid)),
  );
  handle("proxmox:stopGuest", services, (id, node, type, vmid) =>
    services.proxmox.stopGuest(String(id), String(node), type as GuestType, Number(vmid)),
  );
  handle("proxmox:createSnapshot", services, (id, node, type, vmid, snapname) =>
    services.proxmox.createSnapshot(
      String(id),
      String(node),
      type as GuestType,
      Number(vmid),
      String(snapname),
    ),
  );

  // ---- System ----
  handle("system:chooseDownloadDirectory", services, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handle("system:appInfo", services, () => ({
    name: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
  }));

  // Log the active allowlist once, for auditability.
  logger.info({
    module: "ipc",
    event: "handlers-registered",
    detail: { channels: INVOKE_CHANNELS.length },
  });
}

/** Apply a settings change that affects the main process (log level). */
export function applyRuntimeSettings(settings: AppSettings): void {
  setLogLevel(settings.logLevel);
}
