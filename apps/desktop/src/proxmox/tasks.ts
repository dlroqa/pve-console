/**
 * Task/history read endpoints (spec §29, §9.4). FOUNDATION ONLY (Version 2/3).
 */

import type { ProxmoxClient } from "./client";

export interface TaskEntry {
  upid: string;
  node: string;
  type: string;
  status?: string;
  starttime?: number;
  endtime?: number;
}

export async function listNodeTasks(client: ProxmoxClient, node: string): Promise<TaskEntry[]> {
  const data = await client.get<
    Array<{ upid: string; node?: string; type: string; status?: string; starttime?: number; endtime?: number }>
  >(`/nodes/${encodeURIComponent(node)}/tasks`);
  return data.map((t) => ({
    upid: t.upid,
    node: t.node ?? node,
    type: t.type,
    status: t.status,
    starttime: t.starttime,
    endtime: t.endtime,
  }));
}
