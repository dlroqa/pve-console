/**
 * Native Proxmox API service (spec §9, §19, §36).
 *
 * Orchestrates the read-only API client from the trusted main process. This is
 * the start of Version 2 and does NOT replace or remove the embedded Proxmox
 * browser (spec §9, §53). Key rules enforced here:
 *  - prefer a restricted API token; never require root (spec §9.2, §19);
 *  - store the token SECRET only via SecretStore (encrypted); token NAME
 *    metadata lives in a separate non-secret config file (spec §9.3, §37);
 *  - API errors are returned structured and never affect the embedded browser
 *    (spec §9 acceptance).
 */

import { ConfigStore } from "../storage/config-store";
import { SecretStore } from "../storage/secret-store";
import { logger } from "../shared/logger";
import { ErrorCode } from "../shared/types";
import { ProxmoxClient, ProxmoxApiError } from "./client";
import { verifyToken } from "./auth";
import { listNodes } from "./nodes";
import { listGuests } from "./guests";
import { listStorage } from "./storage";
import {
  startGuest,
  shutdownGuest,
  rebootGuest,
  stopGuest,
  createSnapshot,
  type GuestType,
} from "./guest-actions";
import type { ProfileManager } from "../profiles/profile-manager";
import type { CertificateManager } from "../certificates/certificate-manager";
import type {
  ApiTokenMeta,
  ApiTokenStatus,
  DashboardData,
  NodeSummary,
  GuestSummary,
} from "./proxmox-types";

const TOKEN_META_FILE = "api-tokens";
const TOKEN_NAME_PATTERN = /^[^\s@]+@[^\s@!]+![^\s!]+$/;

function secretKey(profileId: string): string {
  return `proxmox-token-secret:${profileId}`;
}

export class ProxmoxService {
  constructor(
    private readonly profiles: ProfileManager,
    private readonly certificates: CertificateManager,
    private readonly secrets: SecretStore,
    private readonly config: ConfigStore,
  ) {}

  private async readMeta(): Promise<Record<string, ApiTokenMeta>> {
    return this.config.readJson<Record<string, ApiTokenMeta>>(TOKEN_META_FILE, {});
  }

  /** Store a restricted API token for a profile (spec §9.2, §9.3). */
  async setToken(profileId: string, tokenName: string, tokenSecret: string): Promise<void> {
    if (!TOKEN_NAME_PATTERN.test(tokenName)) {
      throw new ProxmoxApiError({
        code: ErrorCode.API_PERMISSION_ERROR,
        message: 'Token name must look like "user@realm!tokenid".',
      });
    }
    if (!tokenSecret || tokenSecret.trim().length === 0) {
      throw new ProxmoxApiError({
        code: ErrorCode.API_PERMISSION_ERROR,
        message: "Token secret is required.",
      });
    }
    if (!this.secrets.isAvailable()) {
      throw new ProxmoxApiError({
        code: ErrorCode.INTERNAL_ERROR,
        message: "OS secret storage is unavailable; cannot store the token securely.",
      });
    }

    await this.secrets.setSecret(secretKey(profileId), tokenSecret);
    const meta = await this.readMeta();
    meta[profileId] = { tokenName, createdAt: new Date().toISOString() };
    await this.config.writeJson(TOKEN_META_FILE, meta);
    logger.info({ module: "proxmox", event: "token-set", serverProfileId: profileId });
  }

  async getTokenStatus(profileId: string): Promise<ApiTokenStatus> {
    const meta = await this.readMeta();
    const entry = meta[profileId];
    if (!entry) return { configured: false };
    return { configured: true, tokenName: entry.tokenName, createdAt: entry.createdAt };
  }

  /** Remove the token so the profile falls back to browser-only mode (spec §9 acceptance). */
  async removeToken(profileId: string): Promise<void> {
    await this.secrets.deleteSecret(secretKey(profileId));
    const meta = await this.readMeta();
    if (profileId in meta) {
      delete meta[profileId];
      await this.config.writeJson(TOKEN_META_FILE, meta);
    }
    logger.info({ module: "proxmox", event: "token-removed", serverProfileId: profileId });
  }

  private async buildClient(profileId: string): Promise<ProxmoxClient> {
    const profile = await this.profiles.get(profileId);
    if (!profile) {
      throw new ProxmoxApiError({ code: ErrorCode.PROFILE_ERROR, message: "Unknown server profile." });
    }
    const meta = (await this.readMeta())[profileId];
    if (!meta) {
      throw new ProxmoxApiError({
        code: ErrorCode.API_PERMISSION_ERROR,
        message: "No API token configured for this server.",
      });
    }
    const tokenSecret = await this.secrets.getSecret(secretKey(profileId));
    if (!tokenSecret) {
      throw new ProxmoxApiError({
        code: ErrorCode.API_PERMISSION_ERROR,
        message: "API token secret is missing from secure storage.",
      });
    }
    const pin = await this.certificates.getPin(profile.host, profile.port);
    return new ProxmoxClient({
      protocol: profile.protocol,
      host: profile.host,
      port: profile.port,
      tokenName: meta.tokenName,
      tokenSecret,
      pinnedFingerprint: pin?.fingerprintSha256,
    });
  }

  /** Verify a token by calling the version endpoint. */
  async verify(profileId: string): Promise<{ version: string }> {
    const client = await this.buildClient(profileId);
    return verifyToken(client);
  }

  async getNodes(profileId: string): Promise<NodeSummary[]> {
    return listNodes(await this.buildClient(profileId));
  }

  async getGuests(profileId: string): Promise<GuestSummary[]> {
    return listGuests(await this.buildClient(profileId));
  }

  // ---- Native VM/LXC controls (Phase 11). Destructive actions (stop) are
  // confirmed in the UI before reaching here (spec §11). ----

  async startGuest(profileId: string, node: string, type: GuestType, vmid: number): Promise<string> {
    return startGuest(await this.buildClient(profileId), node, type, vmid);
  }

  async shutdownGuest(profileId: string, node: string, type: GuestType, vmid: number): Promise<string> {
    return shutdownGuest(await this.buildClient(profileId), node, type, vmid);
  }

  async rebootGuest(profileId: string, node: string, type: GuestType, vmid: number): Promise<string> {
    return rebootGuest(await this.buildClient(profileId), node, type, vmid);
  }

  async stopGuest(profileId: string, node: string, type: GuestType, vmid: number): Promise<string> {
    return stopGuest(await this.buildClient(profileId), node, type, vmid);
  }

  async createSnapshot(
    profileId: string,
    node: string,
    type: GuestType,
    vmid: number,
    snapname: string,
  ): Promise<string> {
    return createSnapshot(await this.buildClient(profileId), node, type, vmid, snapname);
  }

  /** Aggregate read-only dashboard data (spec §9.4, §10). */
  async getSummary(profileId: string): Promise<DashboardData> {
    const client = await this.buildClient(profileId);
    const [nodes, guests, storage] = await Promise.all([
      listNodes(client),
      listGuests(client),
      listStorage(client),
    ]);

    const vms = guests.filter((g) => g.type === "qemu").length;
    const lxc = guests.filter((g) => g.type === "lxc").length;
    const running = guests.filter((g) => g.status === "running").length;
    const stopped = guests.filter((g) => g.status === "stopped").length;

    const cpuVals = nodes.map((n) => n.cpu ?? 0);
    const cpuUsage = cpuVals.length ? cpuVals.reduce((a, b) => a + b, 0) / cpuVals.length : 0;

    const memTotal = nodes.reduce((a, n) => a + (n.maxmem ?? 0), 0);
    const memUsed = nodes.reduce((a, n) => a + (n.mem ?? 0), 0);
    const memUsage = memTotal > 0 ? memUsed / memTotal : 0;

    const stTotal = storage.reduce((a, s) => a + (s.total ?? 0), 0);
    const stUsed = storage.reduce((a, s) => a + (s.used ?? 0), 0);
    const storageUsage = stTotal > 0 ? stUsed / stTotal : 0;

    return {
      cluster: { nodes: nodes.length, vms, lxc, running, stopped },
      cpuUsage,
      memUsage,
      storageUsage,
      nodes,
      guests,
      storage,
    };
  }
}
