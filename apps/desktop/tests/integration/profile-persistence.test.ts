import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../../src/storage/config-store";
import { ProfileManager } from "../../src/profiles/profile-manager";
import { ProfileValidationError } from "../../src/profiles/profile-schema";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-profiles-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("profile persistence (spec Phase 3 acceptance)", () => {
  it("creates, lists, gets, updates and deletes", async () => {
    const mgr = new ProfileManager(new ConfigStore(dir));
    const created = await mgr.create({ name: "Home", host: "192.168.12.10" });
    expect(created.id).toMatch(/^[a-z0-9]{6,}$/);
    expect(created.port).toBe(8006);

    expect(await mgr.list()).toHaveLength(1);
    expect((await mgr.get(created.id))?.name).toBe("Home");

    const updated = await mgr.update(created.id, { name: "Home PVE" });
    expect(updated.name).toBe("Home PVE");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.createdAt);

    await mgr.delete(created.id);
    expect(await mgr.list()).toHaveLength(0);
  });

  it("persists across a simulated restart (new manager instance)", async () => {
    const store = new ConfigStore(dir);
    const mgr1 = new ProfileManager(store);
    await mgr1.create({ name: "Dev", host: "10.10.20.15" });

    const mgr2 = new ProfileManager(new ConfigStore(dir));
    const list = await mgr2.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Dev");
  });

  it("allows duplicate names with different ids", async () => {
    const mgr = new ProfileManager(new ConfigStore(dir));
    const a = await mgr.create({ name: "PVE", host: "10.0.0.1" });
    const b = await mgr.create({ name: "PVE", host: "10.0.0.2" });
    expect(a.id).not.toBe(b.id);
    expect(await mgr.list()).toHaveLength(2);
  });

  it("rejects invalid host/port", async () => {
    const mgr = new ProfileManager(new ConfigStore(dir));
    await expect(mgr.create({ name: "x", host: "bad host" })).rejects.toBeInstanceOf(
      ProfileValidationError,
    );
    await expect(mgr.create({ name: "x", host: "10.0.0.1", port: 99999 })).rejects.toBeInstanceOf(
      ProfileValidationError,
    );
  });

  it("never writes plaintext secrets to the profile file", async () => {
    const mgr = new ProfileManager(new ConfigStore(dir));
    await mgr.create({ name: "Home", host: "10.0.0.1" });
    // Attempting to pass a secret is rejected outright.
    await expect(
      mgr.create({ name: "Bad", host: "10.0.0.2", password: "hunter2" } as never),
    ).rejects.toBeInstanceOf(ProfileValidationError);

    const raw = await readFile(join(dir, "profiles.json"), "utf8");
    expect(raw.toLowerCase()).not.toContain("password");
    expect(raw.toLowerCase()).not.toContain("hunter2");
    expect(raw.toLowerCase()).not.toContain("secret");
  });
});
