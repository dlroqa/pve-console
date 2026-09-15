import { describe, it, expect } from "vitest";
import {
  normalizeFingerprint,
  fingerprintFromDer,
  fingerprintsEqual,
} from "../../src/certificates/fingerprint";

describe("fingerprint normalization (spec §5.1)", () => {
  const hex = "a".repeat(64);

  it("formats as colon-separated uppercase pairs", () => {
    const out = normalizeFingerprint(hex);
    expect(out).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(out.split(":").length).toBe(32);
  });

  it("accepts input with existing separators and mixed case", () => {
    const colon = normalizeFingerprint(hex);
    expect(normalizeFingerprint(colon.toLowerCase())).toBe(colon);
    expect(normalizeFingerprint(colon)).toBe(colon);
  });

  it("throws on wrong length", () => {
    expect(() => normalizeFingerprint("abcd")).toThrow();
  });

  it("computes a deterministic fingerprint from DER bytes", () => {
    const der = Buffer.from("example-cert-bytes");
    const a = fingerprintFromDer(der);
    const b = fingerprintFromDer(der);
    expect(a).toBe(b);
    expect(a).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  it("compares fingerprints regardless of formatting", () => {
    expect(fingerprintsEqual(hex, normalizeFingerprint(hex))).toBe(true);
    expect(fingerprintsEqual("a".repeat(64), "b".repeat(64))).toBe(false);
  });
});
