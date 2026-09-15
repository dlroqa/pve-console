/**
 * Application-wide constants. Shared between the main and renderer processes.
 * Must contain no secrets and no environment-specific values.
 */

export const APP_NAME = "PVE Console";
export const APP_ID = "com.pveconsole.desktop";
export const APP_SLUG = "pve-console";

/** Default Proxmox connection values (spec §7, §8). */
export const DEFAULT_PROTOCOL = "https" as const;
export const DEFAULT_PORT = 8006;

/** Electron persistent session partition prefix (spec §9). */
export const SESSION_PARTITION_PREFIX = "persist:pve-";

/** Build the isolated session partition name for a given server profile id. */
export function sessionPartitionFor(serverId: string): string {
  return `${SESSION_PARTITION_PREFIX}${serverId}`;
}

/** Valid protocol values for a server profile. */
export const PROTOCOLS = ["https", "http"] as const;

/** Valid connection modes for a server profile (spec §7). */
export const CONNECTION_MODES = ["direct", "tailscale", "vpn", "domain"] as const;

/** Valid certificate handling modes for a server profile (spec §7). */
export const CERTIFICATE_MODES = ["system", "pinned", "trust-once"] as const;

/** Bounds for a valid TCP port. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;
