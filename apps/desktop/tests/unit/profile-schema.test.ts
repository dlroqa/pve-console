import { describe, it, expect } from "vitest";
import {
  normalizeCreateInput,
  validateProfile,
  assertNoSecrets,
  ProfileValidationError,
} from "../../src/profiles/profile-schema";

describe("profile creation defaults (spec §7)", () => {
  it("applies spec default values", () => {
    const n = normalizeCreateInput({ name: "Home", host: "192.168.12.10" });
    expect(n.protocol).toBe("https");
    expect(n.port).toBe(8006);
    expect(n.connectionMode).toBe("direct");
    expect(n.certificateMode).toBe("system");
    expect(n.autoConnect).toBe(false);
  });

  it("rejects invalid host", () => {
    expect(() => normalizeCreateInput({ name: "x", host: "bad_host!" })).toThrow(
      ProfileValidationError,
    );
  });

  it("rejects invalid port", () => {
    expect(() => normalizeCreateInput({ name: "x", host: "10.0.0.1", port: 70000 })).toThrow(
      ProfileValidationError,
    );
  });

  it("rejects missing name", () => {
    expect(() => normalizeCreateInput({ name: "  ", host: "10.0.0.1" })).toThrow(
      ProfileValidationError,
    );
  });
});

describe("secret rejection (spec §6.3, §3.5)", () => {
  it("throws when a secret field is present", () => {
    expect(() => assertNoSecrets({ password: "hunter2" })).toThrow(ProfileValidationError);
    expect(() => assertNoSecrets({ apiToken: "x" })).toThrow(ProfileValidationError);
    expect(() => assertNoSecrets({ name: "ok" })).not.toThrow();
  });

  it("normalizeCreateInput rejects secret-bearing input", () => {
    expect(() =>
      normalizeCreateInput({ name: "x", host: "10.0.0.1", password: "p" } as never),
    ).toThrow(ProfileValidationError);
  });
});

describe("full profile validation", () => {
  const base = {
    id: "abc123def456",
    name: "Home",
    protocol: "https",
    host: "10.0.0.1",
    port: 8006,
    connectionMode: "direct",
    certificateMode: "system",
    autoConnect: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("accepts a valid profile", () => {
    expect(() => validateProfile({ ...base })).not.toThrow();
  });

  it("rejects invalid id", () => {
    expect(() => validateProfile({ ...base, id: "AB" })).toThrow();
  });

  it("rejects invalid certificate mode", () => {
    expect(() => validateProfile({ ...base, certificateMode: "always" })).toThrow();
  });

  it("rejects malformed pinned fingerprint", () => {
    expect(() => validateProfile({ ...base, pinnedFingerprint: "zz:zz" })).toThrow();
  });
});
