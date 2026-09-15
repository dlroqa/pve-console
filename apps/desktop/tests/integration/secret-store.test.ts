import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock Electron's safeStorage with a reversible transform for testing.
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (b: Buffer) => b.toString("utf8").replace(/^enc:/, ""),
  },
}));

import { SecretStore } from "../../src/storage/secret-store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-secrets-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("secret store interface (spec §6.3, §37)", () => {
  it("stores, reads and deletes an encrypted secret", async () => {
    const store = new SecretStore(dir);
    expect(store.isAvailable()).toBe(true);

    await store.setSecret("api-token-srv1", "s3cr3t-value");
    expect(await store.getSecret("api-token-srv1")).toBe("s3cr3t-value");

    await store.deleteSecret("api-token-srv1");
    expect(await store.getSecret("api-token-srv1")).toBeUndefined();
  });

  it("never persists the plaintext secret to disk", async () => {
    const store = new SecretStore(dir);
    await store.setSecret("k", "PLAINTEXT-SECRET");
    const raw = await readFile(join(dir, "secrets.enc.json"), "utf8");
    expect(raw).not.toContain("PLAINTEXT-SECRET");
  });

  it("uses a separate file from config (spec §37)", async () => {
    const store = new SecretStore(dir);
    await store.setSecret("k", "v");
    // The secret file is distinct from config files like profiles.json.
    const raw = await readFile(join(dir, "secrets.enc.json"), "utf8");
    expect(raw).toContain("entries");
  });
});
