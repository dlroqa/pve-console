/**
 * Native VM/LXC control actions (spec §11, Version 3).
 *
 * Implements ONLY the allowed native controls: start, shutdown, reboot, stop,
 * and snapshot creation (spec §11 "Allowed native controls"). Destructive
 * operations (stop, delete, rollback, remove disk, delete snapshot, destroy)
 * must be confirmed by the user in the UI before these are called (spec §11).
 *
 * These call the trusted API client from the main process only (spec §36).
 * Each returns the Proxmox task UPID string.
 */

import type { ProxmoxClient } from "./client";

export type GuestType = "qemu" | "lxc";

function statusPath(node: string, type: GuestType, vmid: number, action: string): string {
  return `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`;
}

export function startGuest(client: ProxmoxClient, node: string, type: GuestType, vmid: number) {
  return client.post<string>(statusPath(node, type, vmid, "start"));
}

/** Graceful ACPI shutdown. */
export function shutdownGuest(client: ProxmoxClient, node: string, type: GuestType, vmid: number) {
  return client.post<string>(statusPath(node, type, vmid, "shutdown"));
}

export function rebootGuest(client: ProxmoxClient, node: string, type: GuestType, vmid: number) {
  return client.post<string>(statusPath(node, type, vmid, "reboot"));
}

/** Hard stop — destructive (may interrupt services). Requires confirmation. */
export function stopGuest(client: ProxmoxClient, node: string, type: GuestType, vmid: number) {
  return client.post<string>(statusPath(node, type, vmid, "stop"));
}

export function createSnapshot(
  client: ProxmoxClient,
  node: string,
  type: GuestType,
  vmid: number,
  snapname: string,
  description?: string,
) {
  const body: Record<string, string> = { snapname };
  if (description) body.description = description;
  return client.post<string>(`/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`, body);
}
