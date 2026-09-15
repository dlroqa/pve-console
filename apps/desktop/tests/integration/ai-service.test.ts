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

describe("AI assistant (spec §12 — optional, advisory, multi-provider)", () => {
  it("defaults to Anthropic and is disabled until a key is configured", async () => {
    const status = await ai.getStatus();
    expect(status.provider).toBe("anthropic");
    expect(status.model).toBe("claude-opus-5");
    expect(status.configured).toBe(false);

    await ai.setApiKey("anthropic", "sk-ant-test-key-1234");
    expect((await ai.getStatus()).configured).toBe(true);
  });

  it("supports an OpenAI-compatible provider with its own key and base URL", async () => {
    const s = await ai.setConfig({ provider: "openai", model: "gpt-4o-mini", baseUrl: "https://example.test/v1" });
    expect(s.provider).toBe("openai");
    expect(s.model).toBe("gpt-4o-mini");
    expect(s.baseUrl).toBe("https://example.test/v1");
    expect(s.configured).toBe(false);

    await ai.setApiKey("openai", "sk-openai-SECRET-123456");
    expect((await ai.getStatus()).configured).toBe(true);
  });

  it("keeps per-provider keys independent when switching providers", async () => {
    await ai.setApiKey("anthropic", "sk-ant-aaaa1111");
    // Switch to openai (no key yet) -> not configured.
    await ai.setConfig({ provider: "openai" });
    expect((await ai.getStatus()).configured).toBe(false);
    // Switch back to anthropic -> still configured.
    await ai.setConfig({ provider: "anthropic" });
    expect((await ai.getStatus()).configured).toBe(true);
  });

  it("stores keys encrypted, never in plaintext", async () => {
    await ai.setApiKey("openai", "sk-openai-PLAINTEXT-999");
    const raw = await readFile(join(dir, "secrets.enc.json"), "utf8");
    expect(raw).not.toContain("sk-openai-PLAINTEXT-999");
  });

  it("refuses analysis when the active provider has no key", async () => {
    await ai.setConfig({ provider: "openai" });
    await expect(ai.analyze("srv1", "explain-error", "boom")).rejects.toBeInstanceOf(AiError);
  });

  it("rejects an empty error input for explain-error", async () => {
    await ai.setApiKey("anthropic", "sk-ant-test-key-1234");
    await expect(ai.analyze("srv1", "explain-error", "   ")).rejects.toBeInstanceOf(AiError);
  });
});
