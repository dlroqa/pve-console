import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../../src/storage/config-store";
import { CertificateManager } from "../../src/certificates/certificate-manager";
import { normalizeFingerprint } from "../../src/certificates/fingerprint";

let dir: string;
const FP_A = normalizeFingerprint("a".repeat(64));
const FP_B = normalizeFingerprint("b".repeat(64));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pve-certs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function observed(fp: string) {
  return {
    subject: "CN=pve",
    issuer: "CN=pve",
    validFrom: "",
    validTo: "",
    fingerprintSha256: fp,
    host: "10.0.0.1",
    port: 8006,
  };
}

describe("certificate storage & evaluation (spec §5, §14)", () => {
  it("pins and persists across restart", async () => {
    const mgr = new CertificateManager(new ConfigStore(dir));
    await mgr.pin("srv1", "10.0.0.1", 8006, FP_A);

    const mgr2 = new CertificateManager(new ConfigStore(dir));
    const evalResult = await mgr2.evaluate(observed(FP_A), "pinned");
    expect(evalResult.status).toBe("trusted-pinned");
  });

  it("blocks on fingerprint mismatch and does not auto-replace", async () => {
    const mgr = new CertificateManager(new ConfigStore(dir));
    await mgr.pin("srv1", "10.0.0.1", 8006, FP_A);
    const result = await mgr.evaluate(observed(FP_B), "pinned");
    expect(result.status).toBe("mismatch");
    if (result.status === "mismatch") {
      expect(result.previousFingerprint).toBe(FP_A);
    }
    // Pin is unchanged until explicitly replaced.
    const pin = await mgr.getPin("10.0.0.1", 8006);
    expect(pin?.fingerprintSha256).toBe(FP_A);
  });

  it("trust-once is runtime only and not persisted", async () => {
    const mgr = new CertificateManager(new ConfigStore(dir));
    mgr.trustOnce("10.0.0.1", 8006, FP_A);
    expect((await mgr.evaluate(observed(FP_A), "trust-once")).status).toBe("trusted-once");

    const mgr2 = new CertificateManager(new ConfigStore(dir));
    expect((await mgr2.evaluate(observed(FP_A), "trust-once")).status).toBe("unknown");
  });

  it("reports unknown for a never-seen certificate", async () => {
    const mgr = new CertificateManager(new ConfigStore(dir));
    expect((await mgr.evaluate(observed(FP_A), "system")).status).toBe("unknown");
  });

  it("removes pins for a deleted profile", async () => {
    const mgr = new CertificateManager(new ConfigStore(dir));
    await mgr.pin("srv1", "10.0.0.1", 8006, FP_A);
    await mgr.removePinForProfile("srv1");
    expect(await mgr.getPin("10.0.0.1", 8006)).toBeUndefined();
  });
});
