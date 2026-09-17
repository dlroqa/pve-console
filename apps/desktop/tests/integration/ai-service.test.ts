import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { ConfigStore } from "../../src/storage/config-store";
import { SecretStore } from "../../src/storage/secret-store";
import { ProfileManager } from "../../src/profiles/profile-manager";
import { CertificateManager } from "../../src/certificates/certificate-manager";
import { ProxmoxService } from "../../src/proxmox/proxmox-service";
import { AiService, AiError, type AiCommandRunner } from "../../src/ai/ai-service";

let directory: string;
let ai: AiService;
let runner: ReturnType<typeof vi.fn<AiCommandRunner>>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pve-ai-"));
  const config = new ConfigStore(directory);
  const secrets = new SecretStore(directory);
  const proxmox = new ProxmoxService(
    new ProfileManager(config),
    new CertificateManager(config),
    secrets,
    config,
  );
  runner = vi.fn<AiCommandRunner>(async (command, args) => {
    if (args.includes("status")) return { stdout: "Signed in", stderr: "", code: 0 };
    if (command === "claude") {
      return { stdout: JSON.stringify({ result: "Safe recommendation", is_error: false }), stderr: "", code: 0 };
    }
    return { stdout: "", stderr: "", code: 0 };
  });
  ai = new AiService(config, proxmox, runner);
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("subscription-backed advisory AI", () => {
  it("uses the Anthropic CLI account by default", async () => {
    const status = await ai.getStatus();
    expect(status.provider).toBe("anthropic");
    expect(status.model).toBe("Account default");
    expect(status.configured).toBe(true);
    expect(status.localUsage.requests).toBe(0);
    expect(runner).toHaveBeenCalledWith("claude", ["auth", "status"]);
  });

  it("switches to the Codex CLI and preserves an optional model override", async () => {
    const status = await ai.setConfig({ provider: "openai", model: "gpt-test" });
    expect(status.provider).toBe("openai");
    expect(status.model).toBe("gpt-test");
    expect(runner).toHaveBeenCalledWith("codex", ["login", "status"]);
  });

  it("runs Claude with tools disabled and records successful local use", async () => {
    const result = await ai.analyze("unused", "explain-error", "connection refused");
    expect(result.text).toBe("Safe recommendation");
    const invocation = runner.mock.calls.find(([command, args]) => command === "claude" && args.includes("--print"));
    expect(invocation?.[1]).toContain("--tools");
    expect(invocation?.[1][invocation[1].indexOf("--tools") + 1]).toBe("");
    expect((await ai.getStatus()).localUsage.requests).toBe(1);
  });

  it("does not count failed analyses", async () => {
    runner.mockImplementation(async (_command, args) => args.includes("status")
      ? { stdout: "Signed in", stderr: "", code: 0 }
      : { stdout: "", stderr: "failed", code: 1 });
    await expect(ai.analyze("unused", "explain-error", "boom")).rejects.toBeInstanceOf(AiError);
    expect((await ai.getStatus()).localUsage.requests).toBe(0);
  });

  it("rejects an empty error input before invoking a model", async () => {
    await expect(ai.analyze("unused", "explain-error", "   ")).rejects.toBeInstanceOf(AiError);
  });
});
