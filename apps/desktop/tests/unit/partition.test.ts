import { describe, it, expect } from "vitest";
import { sessionPartitionFor, SESSION_PARTITION_PREFIX } from "../../src/shared/constants";

describe("session partition creation (spec §9)", () => {
  it("uses the persist:pve- prefix", () => {
    expect(sessionPartitionFor("a8127")).toBe("persist:pve-a8127");
    expect(sessionPartitionFor("a8127").startsWith(SESSION_PARTITION_PREFIX)).toBe(true);
  });

  it("produces a distinct partition per server id", () => {
    const a = sessionPartitionFor("a8127");
    const b = sessionPartitionFor("b1315");
    const c = sessionPartitionFor("c5921");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
