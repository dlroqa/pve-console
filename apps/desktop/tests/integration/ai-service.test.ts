import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Electron safeStorage (reversible) and the Anthropic SDK (never called here).
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, ""),
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class {} }));

import { ConfigStore } from "../../src/storage/config-store";
import { SecretStore } from "../../src/storage/secret-store";
import { ProfileManager } from "../../src/profiles/profile-manager";
import { CertificateManager } from "../../src/certificates/certificate-manager";
import { ProxmoxService } from "../../src/proxmox/proxmox-service";
import { AiService, AiError } from "../../src/ai/ai-service";

let dir: string;
let ai: AiService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-ai-"));
  const config = new ConfigStore(dir);
  const secrets = new SecretStore(dir);
  const profiles = new ProfileManager(config);
  const certs = new CertificateManager(config);
  const proxmox = new ProxmoxService(profiles, certs, secrets, config);
  ai = new AiService(secrets, config, proxmox);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("AI assistant (spec §12 — optional, advisory)", () => {
  it("is disabled until an API key is configured", async () => {
    expect((await ai.getStatus()).configured).toBe(false);
    await ai.setApiKey("sk-ant-test-key-1234");
    const status = await ai.getStatus();
    expect(status.configured).toBe(true);
    expect(status.model).toBe("claude-opus-5");
  });

  it("stores the API key encrypted, never in plaintext", async () => {
    await ai.setApiKey("sk-ant-SECRETVALUE-987654");
    const raw = await readFile(join(dir, "secrets.enc.json"), "utf8");
    expect(raw).not.toContain("sk-ant-SECRETVALUE-987654");
    // getStatus never leaks the key.
    expect(JSON.stringify(await ai.getStatus())).not.toContain("SECRETVALUE");
  });

  it("refuses analysis when not configured (no silent failure)", async () => {
    await expect(ai.analyze("srv1", "explain-error", "boom")).rejects.toBeInstanceOf(AiError);
  });

  it("removing the key disables the assistant", async () => {
    await ai.setApiKey("sk-ant-test-key-1234");
    await ai.removeApiKey();
    expect((await ai.getStatus()).configured).toBe(false);
  });

  it("rejects an empty error input for explain-error", async () => {
    await ai.setApiKey("sk-ant-test-key-1234");
    await expect(ai.analyze("srv1", "explain-error", "   ")).rejects.toBeInstanceOf(AiError);
  });
});
