/**
 * SHA-256 fingerprint calculation and normalization (spec §5.1).
 *
 * Display format: colon-separated uppercase hex pairs, e.g. AA:BB:CC:DD:...
 */

import { createHash } from "node:crypto";

/** Compute the SHA-256 fingerprint of a DER-encoded certificate buffer. */
export function fingerprintFromDer(der: Buffer | Uint8Array): string {
  const hash = createHash("sha256").update(Buffer.from(der)).digest("hex");
  return normalizeFingerprint(hash);
}

/**
 * Normalize any fingerprint representation (with or without separators, any
 * case) into the canonical AA:BB:CC form. Throws if it is not 32 bytes.
 */
export function normalizeFingerprint(input: string): string {
  const hex = input.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (hex.length !== 64) {
    throw new Error("A SHA-256 fingerprint must be 32 bytes (64 hex chars).");
  }
  return (hex.match(/.{2}/g) ?? []).join(":");
}

/** Constant-time-ish comparison of two normalized fingerprints. */
export function fingerprintsEqual(a: string, b: string): boolean {
  try {
    return normalizeFingerprint(a) === normalizeFingerprint(b);
  } catch {
    return false;
  }
}
