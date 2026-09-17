/**
 * IPC channel allowlist (spec §6.2).
 *
 * These are the ONLY channels the preload bridge and main process accept.
 * There is deliberately no generic execute/run/invoke(arbitrary) channel.
 */

/** Request/response channels (ipcRenderer.invoke -> ipcMain.handle). */
export const INVOKE_CHANNELS = [
  "profiles:list",
  "profiles:get",
  "profiles:create",
  "profiles:update",
  "profiles:delete",

  "server:connect",
  "server:disconnect",
  "server:reload",
  "server:back",
  "server:forward",
  "server:reconnect",
  "server:showNative",
  "server:openExternal",
  "server:setContentBounds",
  "server:clearSession",

  "diagnostics:run",

  "certificate:list",
  "certificate:respond",

  "settings:get",
  "settings:set",

  "system:chooseDownloadDirectory",
  "system:appInfo",

  "proxmox:getTokenStatus",
  "proxmox:setToken",
  "proxmox:removeToken",
  "proxmox:verifyToken",
  "proxmox:getSummary",
  "proxmox:getNodes",
  "proxmox:getGuests",
  "proxmox:startGuest",
  "proxmox:shutdownGuest",
  "proxmox:rebootGuest",
  "proxmox:stopGuest",
  "proxmox:createSnapshot",

  "ai:getStatus",
  "ai:setConfig",
  "ai:analyze",

  "terminalProfiles:list",
  "terminalProfiles:create",
  "terminalProfiles:update",
  "terminalProfiles:delete",
  "terminal:startLocal",
  "terminal:connect",
  "terminal:connectDirect",
  "terminal:write",
  "terminal:resize",
  "terminal:disconnect",
  "terminal:listDirectory",
  "sshHost:respond",
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** One-way main -> renderer event channels the renderer may subscribe to. */
export const EVENT_CHANNELS = [
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

export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(x: string): x is InvokeChannel {
  return (INVOKE_CHANNELS as readonly string[]).includes(x);
}

export function isEventChannel(x: string): x is EventChannel {
  return (EVENT_CHANNELS as readonly string[]).includes(x);
}
