/**
 * Native Proxmox REST API types (spec §9, §28).
 *
 * NOTE: This module is foundation for the Version 2 native API layer. It is
 * intentionally NOT wired into any Version 1 feature (spec §53). The native
 * API is used only for native app features, never as a replacement for the
 * embedded Proxmox web interface (spec §0.1.14).
 */

export interface ProxmoxApiTokenCredential {
  /** e.g. "root@pam" or a dedicated least-privilege user. */
  user: string;
  /** Token id (the part after "!"). */
  tokenId: string;
  /** The secret is stored via SecretStore, never in plaintext config. */
  secretRef: string;
}

export interface NodeSummary {
  node: string;
  status: "online" | "offline" | "unknown";
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
}

export interface GuestSummary {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  node: string;
  status: "running" | "stopped" | "paused" | "unknown";
  cpu?: number;
  mem?: number;
  maxmem?: number;
}

export interface StorageSummary {
  storage: string;
  node: string;
  type: string;
  total?: number;
  used?: number;
  avail?: number;
}

export interface ClusterSummary {
  nodes: number;
  vms: number;
  lxc: number;
  running: number;
  stopped: number;
}

/** Aggregate data for the native dashboard (spec §10, Phase 9.4/§28). */
export interface DashboardData {
  cluster: ClusterSummary;
  /** Fractions in the range 0..1. */
  cpuUsage: number;
  memUsage: number;
  storageUsage: number;
  nodes: NodeSummary[];
  guests: GuestSummary[];
  storage: StorageSummary[];
}

/** Whether a restricted API token is configured for a profile (never the secret). */
export interface ApiTokenStatus {
  configured: boolean;
  tokenName?: string;
  createdAt?: string;
}

/** Persisted (non-secret) API token metadata. The secret lives in SecretStore. */
export interface ApiTokenMeta {
  tokenName: string;
  createdAt: string;
}
