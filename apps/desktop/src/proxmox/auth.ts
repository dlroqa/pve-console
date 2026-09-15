/**
 * Native Proxmox authentication helpers (spec §9.2, §19).
 *
 * FOUNDATION ONLY (Version 2). Version 1 does NOT reimplement Proxmox
 * authentication — the embedded browser uses the normal Proxmox login page
 * (spec §13). This module prefers a restricted API token and never requires
 * root credentials.
 */

import type { ProxmoxClient } from "./client";

/** Verify an API token works and can read the version endpoint. */
export async function verifyToken(client: ProxmoxClient): Promise<{ version: string }> {
  const data = await client.get<{ version: string; release?: string }>("/version");
  return { version: data.version };
}
