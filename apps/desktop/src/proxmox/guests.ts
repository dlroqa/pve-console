/**
 * VM/LXC read endpoints (spec §9.4). FOUNDATION ONLY (Version 2).
 *
 * Uses the cluster resources endpoint for an aggregate guest list. No
 * destructive or state-changing calls live here — those belong to a later
 * phase behind explicit confirmation (spec §11).
 */

import type { ProxmoxClient } from "./client";
import type { GuestSummary } from "./proxmox-types";

export async function listGuests(client: ProxmoxClient): Promise<GuestSummary[]> {
  const data = await client.get<
    Array<{
      type: string;
      vmid?: number;
      name?: string;
      node?: string;
      status?: string;
      cpu?: number;
      mem?: number;
      maxmem?: number;
    }>
  >("/cluster/resources?type=vm");
  return data
    .filter((r) => r.type === "qemu" || r.type === "lxc")
    .map((r) => ({
      vmid: r.vmid ?? 0,
      name: r.name ?? `guest-${r.vmid ?? "?"}`,
      type: r.type === "lxc" ? "lxc" : "qemu",
      node: r.node ?? "",
      status:
        r.status === "running"
          ? "running"
          : r.status === "stopped"
            ? "stopped"
            : r.status === "paused"
              ? "paused"
              : "unknown",
      cpu: r.cpu,
      mem: r.mem,
      maxmem: r.maxmem,
    }));
}
