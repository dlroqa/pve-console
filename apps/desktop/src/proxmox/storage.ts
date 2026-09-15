/**
 * Storage read endpoints (spec §9.4). FOUNDATION ONLY (Version 2).
 */

import type { ProxmoxClient } from "./client";
import type { StorageSummary } from "./proxmox-types";

export async function listStorage(client: ProxmoxClient): Promise<StorageSummary[]> {
  const data = await client.get<
    Array<{ storage: string; node: string; type: string; total?: number; used?: number; avail?: number }>
  >("/cluster/resources?type=storage");
  return data.map((s) => ({
    storage: s.storage,
    node: s.node,
    type: s.type,
    total: s.total,
    used: s.used,
    avail: s.avail,
  }));
}
