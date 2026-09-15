import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../../src/storage/config-store";
import { ProfileManager } from "../../src/profiles/profile-manager";
import { sessionPartitionFor, SESSION_PARTITION_PREFIX } from "../../src/shared/constants";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-sessions-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("session isolation partitions (spec §9)", () => {
  it("assigns a unique persistent partition to each created profile", async () => {
    const mgr = new ProfileManager(new ConfigStore(dir));
    const a = await mgr.create({ name: "A", host: "10.0.0.1" });
    const b = await mgr.create({ name: "B", host: "10.0.0.2" });

    const pa = sessionPartitionFor(a.id);
    const pb = sessionPartitionFor(b.id);

    expect(pa).not.toBe(pb);
    expect(pa.startsWith(SESSION_PARTITION_PREFIX)).toBe(true);
    expect(pb.startsWith(SESSION_PARTITION_PREFIX)).toBe(true);
    // Persistent (not in-memory) partitions so auth survives restarts.
    expect(pa.startsWith("persist:")).toBe(true);
  });
});
