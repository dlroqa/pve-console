import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Electron safeStorage (reversible transform) for token-secret tests.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, ""),
  },
}));

import { ConfigStore } from "../../src/storage/config-store";
import { SecretStore } from "../../src/storage/secret-store";
import { ProfileManager } from "../../src/profiles/profile-manager";
import { CertificateManager } from "../../src/certificates/certificate-manager";
import { ProxmoxService } from "../../src/proxmox/proxmox-service";
import { ProxmoxApiError } from "../../src/proxmox/client";

let dir: string;
let svc: ProxmoxService;
let profileId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-proxmox-"));
  const config = new ConfigStore(dir);
  const profiles = new ProfileManager(config);
  const certs = new CertificateManager(config);
  const secrets = new SecretStore(dir);
  svc = new ProxmoxService(profiles, certs, secrets, config);
  const p = await profiles.create({ name: "Home", host: "10.0.0.1" });
  profileId = p.id;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Proxmox API token storage (spec §9.2, §9.3 — Phase 9 acceptance)", () => {
  it("stores and reports token status without exposing the secret", async () => {
    expect((await svc.getTokenStatus(profileId)).configured).toBe(false);

    await svc.setToken(profileId, "svc@pve!dashboard", "SUPER-SECRET-TOKEN");
    const status = await svc.getTokenStatus(profileId);
    expect(status.configured).toBe(true);
    expect(status.tokenName).toBe("svc@pve!dashboard");
    expect(JSON.stringify(status)).not.toContain("SUPER-SECRET-TOKEN");
  });

  it("never writes the token secret in plaintext", async () => {
    await svc.setToken(profileId, "svc@pve!dashboard", "SUPER-SECRET-TOKEN");

    const meta = await readFile(join(dir, "api-tokens.json"), "utf8");
    expect(meta).toContain("svc@pve!dashboard");
    expect(meta).not.toContain("SUPER-SECRET-TOKEN");

    const secretsRaw = await readFile(join(dir, "secrets.enc.json"), "utf8");
    expect(secretsRaw).not.toContain("SUPER-SECRET-TOKEN");
  });

  it("removing the token clears status (falls back to browser-only mode)", async () => {
    await svc.setToken(profileId, "svc@pve!dashboard", "SUPER-SECRET-TOKEN");
    await svc.removeToken(profileId);
    expect((await svc.getTokenStatus(profileId)).configured).toBe(false);
    // Summary now fails cleanly with a structured error (does not crash).
    await expect(svc.getSummary(profileId)).rejects.toBeInstanceOf(ProxmoxApiError);
  });

  it("rejects malformed token names", async () => {
    await expect(svc.setToken(profileId, "not-a-token", "x")).rejects.toBeInstanceOf(
      ProxmoxApiError,
    );
  });

  it("guest control actions fail cleanly without a token (spec §11)", async () => {
    await expect(svc.startGuest(profileId, "pve", "qemu", 100)).rejects.toBeInstanceOf(
      ProxmoxApiError,
    );
    await expect(svc.stopGuest(profileId, "pve", "qemu", 100)).rejects.toBeInstanceOf(
      ProxmoxApiError,
    );
    await expect(
      svc.createSnapshot(profileId, "pve", "lxc", 101, "snap1"),
    ).rejects.toBeInstanceOf(ProxmoxApiError);
  });
});
