/**
 * Restricted preload bridge (spec §6.2, Phase 2).
 *
 * Exposes ONLY an explicit, narrow API to the native renderer via
 * contextBridge. There is no generic execute/invoke(arbitrary) surface. This
 * preload is attached to the NATIVE shell only — never to remote Proxmox
 * content.
 *
 * It is sandboxed, so it must be self-contained (no relative requires); the
 * event channel allowlist is inlined and kept in sync with
 * shared/ipc-channels.ts.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

// Keep in sync with EVENT_CHANNELS in shared/ipc-channels.ts.
const EVENT_CHANNELS = [
  "certificate:prompt",
  "server:navigation",
  "server:status",
  "server:crashed",
  "server:load-error",
  "server:loaded",
  "terminal:data",
  "terminal:status",
  "sshHost:prompt",
] as const;

type Unsubscribe = () => void;

const api = {
  profiles: {
    list: () => ipcRenderer.invoke("profiles:list"),
    get: (id: string) => ipcRenderer.invoke("profiles:get", id),
    create: (input: unknown) => ipcRenderer.invoke("profiles:create", input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke("profiles:update", id, patch),
    delete: (id: string) => ipcRenderer.invoke("profiles:delete", id),
  },
  server: {
    connect: (id: string) => ipcRenderer.invoke("server:connect", id),
    disconnect: (id: string) => ipcRenderer.invoke("server:disconnect", id),
    reload: () => ipcRenderer.invoke("server:reload"),
    back: () => ipcRenderer.invoke("server:back"),
    forward: () => ipcRenderer.invoke("server:forward"),
    reconnect: (id: string) => ipcRenderer.invoke("server:reconnect", id),
    showNative: () => ipcRenderer.invoke("server:showNative"),
    openExternal: (id: string) => ipcRenderer.invoke("server:openExternal", id),
    setContentBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke("server:setContentBounds", bounds),
    clearSession: (id: string) => ipcRenderer.invoke("server:clearSession", id),
  },
  diagnostics: {
    run: (target: unknown) => ipcRenderer.invoke("diagnostics:run", target),
  },
  certificate: {
    list: () => ipcRenderer.invoke("certificate:list"),
    respond: (requestId: string, decision: string) =>
      ipcRenderer.invoke("certificate:respond", requestId, decision),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (settings: unknown) => ipcRenderer.invoke("settings:set", settings),
  },
  system: {
    chooseDownloadDirectory: () => ipcRenderer.invoke("system:chooseDownloadDirectory"),
    appInfo: () => ipcRenderer.invoke("system:appInfo"),
  },
  proxmox: {
    getTokenStatus: (id: string) => ipcRenderer.invoke("proxmox:getTokenStatus", id),
    setToken: (id: string, tokenName: string, tokenSecret: string) =>
      ipcRenderer.invoke("proxmox:setToken", id, tokenName, tokenSecret),
    removeToken: (id: string) => ipcRenderer.invoke("proxmox:removeToken", id),
    verifyToken: (id: string) => ipcRenderer.invoke("proxmox:verifyToken", id),
    getSummary: (id: string) => ipcRenderer.invoke("proxmox:getSummary", id),
    getNodes: (id: string) => ipcRenderer.invoke("proxmox:getNodes", id),
    getGuests: (id: string) => ipcRenderer.invoke("proxmox:getGuests", id),
    startGuest: (id: string, node: string, type: string, vmid: number) =>
      ipcRenderer.invoke("proxmox:startGuest", id, node, type, vmid),
    shutdownGuest: (id: string, node: string, type: string, vmid: number) =>
      ipcRenderer.invoke("proxmox:shutdownGuest", id, node, type, vmid),
    rebootGuest: (id: string, node: string, type: string, vmid: number) =>
      ipcRenderer.invoke("proxmox:rebootGuest", id, node, type, vmid),
    stopGuest: (id: string, node: string, type: string, vmid: number) =>
      ipcRenderer.invoke("proxmox:stopGuest", id, node, type, vmid),
    createSnapshot: (id: string, node: string, type: string, vmid: number, snapname: string) =>
      ipcRenderer.invoke("proxmox:createSnapshot", id, node, type, vmid, snapname),
  },
  ai: {
    getStatus: () => ipcRenderer.invoke("ai:getStatus"),
    setConfig: (input: { provider: string; model?: string; baseUrl?: string }) =>
      ipcRenderer.invoke("ai:setConfig", input),
    setApiKey: (provider: string, key: string) => ipcRenderer.invoke("ai:setApiKey", provider, key),
    removeApiKey: (provider: string) => ipcRenderer.invoke("ai:removeApiKey", provider),
    analyze: (profileId: string, kind: string, input?: string) =>
      ipcRenderer.invoke("ai:analyze", profileId, kind, input),
  },
  terminalProfiles: {
    list: () => ipcRenderer.invoke("terminalProfiles:list"),
    create: (input: unknown) => ipcRenderer.invoke("terminalProfiles:create", input),
    delete: (id: string) => ipcRenderer.invoke("terminalProfiles:delete", id),
  },
  terminal: {
    connect: (input: unknown) => ipcRenderer.invoke("terminal:connect", input),
    connectDirect: (input: unknown) => ipcRenderer.invoke("terminal:connectDirect", input),
    write: (sessionId: string, data: string) =>
      ipcRenderer.invoke("terminal:write", sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
    disconnect: (sessionId: string) => ipcRenderer.invoke("terminal:disconnect", sessionId),
    respondToHostKey: (requestId: string, decision: string) =>
      ipcRenderer.invoke("sshHost:respond", requestId, decision),
  },
  /** Subscribe to an allowlisted main->renderer event. Returns an unsubscribe fn. */
  on: (channel: string, listener: (payload: unknown) => void): Unsubscribe => {
    if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`Unapproved event channel: ${channel}`);
    }
    const handler = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};

contextBridge.exposeInMainWorld("pve", api);

export type PveApi = typeof api;
