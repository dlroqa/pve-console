/**
 * Node read endpoints (spec §9.4). FOUNDATION ONLY (Version 2).
 */

import type { ProxmoxClient } from "./client";
import type { NodeSummary } from "./proxmox-types";

export async function listNodes(client: ProxmoxClient): Promise<NodeSummary[]> {
  const data = await client.get<
    Array<{ node: string; status: string; cpu?: number; maxcpu?: number; mem?: number; maxmem?: number; uptime?: number }>
  >("/nodes");
  return data.map((n) => ({
    node: n.node,
    status: n.status === "online" ? "online" : n.status === "offline" ? "offline" : "unknown",
    cpu: n.cpu,
    maxcpu: n.maxcpu,
    mem: n.mem,
    maxmem: n.maxmem,
    uptime: n.uptime,
  }));
}
