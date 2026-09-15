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
import type {
  ApiTokenStatus,
  DashboardData,
  NodeSummary,
  GuestSummary,
} from "../proxmox/proxmox-types";
import type { AiStatus, AiAnalysisResult } from "../ai/ai-types";

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
  proxmox: {
    getTokenStatus: (id: string) => Promise<IpcResult<ApiTokenStatus>>;
    setToken: (id: string, tokenName: string, tokenSecret: string) => Promise<IpcResult<boolean>>;
    removeToken: (id: string) => Promise<IpcResult<boolean>>;
    verifyToken: (id: string) => Promise<IpcResult<{ version: string }>>;
    getSummary: (id: string) => Promise<IpcResult<DashboardData>>;
    getNodes: (id: string) => Promise<IpcResult<NodeSummary[]>>;
    getGuests: (id: string) => Promise<IpcResult<GuestSummary[]>>;
    startGuest: (id: string, node: string, type: string, vmid: number) => Promise<IpcResult<string>>;
    shutdownGuest: (id: string, node: string, type: string, vmid: number) => Promise<IpcResult<string>>;
    rebootGuest: (id: string, node: string, type: string, vmid: number) => Promise<IpcResult<string>>;
    stopGuest: (id: string, node: string, type: string, vmid: number) => Promise<IpcResult<string>>;
    createSnapshot: (
      id: string,
      node: string,
      type: string,
      vmid: number,
      snapname: string,
    ) => Promise<IpcResult<string>>;
  };
  ai: {
    getStatus: () => Promise<IpcResult<AiStatus>>;
    setApiKey: (key: string) => Promise<IpcResult<boolean>>;
    removeApiKey: () => Promise<IpcResult<boolean>>;
    analyze: (profileId: string, kind: string, input?: string) => Promise<IpcResult<AiAnalysisResult>>;
  };
  on: (channel: string, listener: (payload: unknown) => void) => () => void;
}

declare global {
  interface Window {
    pve: PveBridge;
  }
}

export {};
