/**
 * Ambient typing for the preload bridge exposed on `window.pve`.
 * Mirrors src/main/preload.ts. Everything returns IpcResult<T>.
 */

import type { AppSettings, IpcResult } from "../shared/types";
import type {
  ServerProfile,
  CreateServerProfileInput,
  UpdateServerProfileInput,
} from "../profiles/profile-types";
import type { DiagnosticsReport, DiagnosticsTarget } from "../diagnostics/diagnostics-types";
import type { CertificatePin } from "../certificates/certificate-types";
import type { ContentBounds } from "../main/webcontents-manager";

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface PveBridge {
  profiles: {
    list: () => Promise<IpcResult<ServerProfile[]>>;
    get: (id: string) => Promise<IpcResult<ServerProfile | undefined>>;
    create: (input: CreateServerProfileInput) => Promise<IpcResult<ServerProfile>>;
    update: (id: string, patch: UpdateServerProfileInput) => Promise<IpcResult<ServerProfile>>;
    delete: (id: string) => Promise<IpcResult<boolean>>;
  };
  server: {
    connect: (id: string) => Promise<IpcResult<boolean>>;
    disconnect: (id: string) => Promise<IpcResult<boolean>>;
    reload: () => Promise<IpcResult<boolean>>;
    back: () => Promise<IpcResult<boolean>>;
    forward: () => Promise<IpcResult<boolean>>;
    reconnect: (id: string) => Promise<IpcResult<boolean>>;
    showNative: () => Promise<IpcResult<boolean>>;
    setContentBounds: (bounds: ContentBounds) => Promise<IpcResult<boolean>>;
    clearSession: (id: string) => Promise<IpcResult<boolean>>;
  };
  diagnostics: {
    run: (target: DiagnosticsTarget) => Promise<IpcResult<DiagnosticsReport>>;
  };
  certificate: {
    list: () => Promise<IpcResult<CertificatePin[]>>;
    respond: (requestId: string, decision: string) => Promise<IpcResult<boolean>>;
  };
  settings: {
    get: () => Promise<IpcResult<AppSettings>>;
    set: (settings: AppSettings) => Promise<IpcResult<AppSettings>>;
  };
  system: {
    chooseDownloadDirectory: () => Promise<IpcResult<string | undefined>>;
    appInfo: () => Promise<IpcResult<AppInfo>>;
  };
  on: (channel: string, listener: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    pve: PveBridge;
  }
}

export {};
