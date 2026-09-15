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
