import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^encrypted:/, ""),
  },
}));

import { ConfigStore } from "../../src/storage/config-store";
import { SecretStore } from "../../src/storage/secret-store";
import { SshProfileManager } from "../../src/ssh/ssh-profile-manager";

let directory: string;
let manager: SshProfileManager;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pve-ssh-profile-"));
  manager = new SshProfileManager(new ConfigStore(directory), new SecretStore(directory));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("SSH profile persistence", () => {
  it("keeps credentials out of the non-secret profile file", async () => {
    const profile = await manager.create({
      name: "Test VM",
      host: "192.168.1.50",
      username: "root",
      authType: "password",
      credential: " password with spaces ",
      rememberCredential: true,
    });

    expect(profile.port).toBe(22);
    expect(profile.hasCredential).toBe(true);
    expect(await manager.getCredential(profile.id)).toEqual({
      credential: " password with spaces ",
    });

    const profilesFile = await readFile(join(directory, "ssh-profiles.json"), "utf8");
    expect(profilesFile).not.toContain("password with spaces");
    expect(profilesFile).not.toContain("credential");
  });

  it("supports session-only credentials and removes profiles cleanly", async () => {
    const profile = await manager.create({
      name: "Ephemeral VM",
      host: "vm.example.test",
      port: 2222,
      username: "deploy",
      authType: "private-key",
      rememberCredential: false,
    });

    expect(profile.hasCredential).toBe(false);
    expect(await manager.getCredential(profile.id)).toBeUndefined();

    await manager.delete(profile.id);
    expect(await manager.list()).toEqual([]);
  });

  it("rejects invalid ports", async () => {
    await expect(
      manager.create({
        name: "Bad VM",
        host: "127.0.0.1",
        port: 70_000,
        username: "root",
        authType: "password",
      }),
    ).rejects.toThrow("SSH port must be between 1 and 65535");
  });
});
