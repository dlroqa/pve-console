/**
 * Schema validation for server profiles (spec §3.2, §3.5).
 *
 * Rejects invalid host, port, protocol, profile id, certificate mode and
 * connection mode. Also rejects any profile object that carries a plaintext
 * secret field — profiles must never contain credentials (spec §6.3, §0.2).
 */

import { CONNECTION_MODES, CERTIFICATE_MODES, DEFAULT_PORT, DEFAULT_PROTOCOL } from "../shared/constants";
import { isValidHost, isValidPort, isValidProtocol } from "../shared/validation";
import type { ServerProfile, CreateServerProfileInput } from "./profile-types";

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

/** Keys that must never appear in a persisted profile (secret leakage guard). */
export const FORBIDDEN_PROFILE_KEYS = [
  "password",
  "rootPassword",
  "userPassword",
  "sessionPassword",
  "apiSecret",
  "secret",
  "token",
  "apiToken",
  "ticket",
  "csrf",
  "csrfToken",
] as const;

const ID_PATTERN = /^[a-z0-9]{6,}$/;
const FINGERPRINT_PATTERN = /^([0-9A-Fa-f]{2})(:[0-9A-Fa-f]{2}){31}$/;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ProfileValidationError(message);
}

/** Throws if the object contains any forbidden secret-bearing key. */
export function assertNoSecrets(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if ((FORBIDDEN_PROFILE_KEYS as readonly string[]).includes(key)) {
      throw new ProfileValidationError(
        `Server profile must not contain secret field "${key}".`,
      );
    }
  }
}

/** Validate a fully-formed profile (e.g. loaded from disk). */
export function validateProfile(input: unknown): asserts input is ServerProfile {
  assert(input && typeof input === "object", "Profile must be an object.");
  const p = input as Record<string, unknown>;

  assertNoSecrets(p);

  assert(typeof p.id === "string" && ID_PATTERN.test(p.id), "Invalid profile id.");
  assert(typeof p.name === "string" && p.name.trim().length > 0, "Profile name is required.");
  assert(isValidProtocol(p.protocol), "Invalid protocol (expected 'https' or 'http').");
  assert(isValidHost(p.host), "Invalid host/address.");
  assert(isValidPort(p.port), "Invalid port (expected 1-65535).");
  assert(
    typeof p.connectionMode === "string" &&
      (CONNECTION_MODES as readonly string[]).includes(p.connectionMode),
    "Invalid connection mode.",
  );
  assert(
    typeof p.certificateMode === "string" &&
      (CERTIFICATE_MODES as readonly string[]).includes(p.certificateMode),
    "Invalid certificate mode.",
  );
  if (p.pinnedFingerprint !== undefined) {
    assert(
      typeof p.pinnedFingerprint === "string" && FINGERPRINT_PATTERN.test(p.pinnedFingerprint),
      "Invalid pinned certificate fingerprint.",
    );
  }
  assert(typeof p.autoConnect === "boolean", "autoConnect must be a boolean.");
  assert(typeof p.createdAt === "string", "createdAt must be a string.");
  assert(typeof p.updatedAt === "string", "updatedAt must be a string.");
}

/** Validate and normalize creation input, applying spec default values. */
export function normalizeCreateInput(input: CreateServerProfileInput): {
  name: string;
  protocol: ServerProfile["protocol"];
  host: string;
  port: number;
  connectionMode: ServerProfile["connectionMode"];
  certificateMode: ServerProfile["certificateMode"];
  pinnedFingerprint?: string;
  autoConnect: boolean;
} {
  assert(input && typeof input === "object", "Input must be an object.");
  assertNoSecrets(input as unknown as Record<string, unknown>);

  const name = String(input.name ?? "").trim();
  assert(name.length > 0, "Profile name is required.");

  const host = String(input.host ?? "").trim();
  assert(isValidHost(host), "Invalid host/address.");

  const protocol = input.protocol ?? DEFAULT_PROTOCOL;
  assert(isValidProtocol(protocol), "Invalid protocol.");

  const port = input.port ?? DEFAULT_PORT;
  assert(isValidPort(port), "Invalid port (expected 1-65535).");

  const connectionMode = input.connectionMode ?? "direct";
  assert(
    (CONNECTION_MODES as readonly string[]).includes(connectionMode),
    "Invalid connection mode.",
  );

  const certificateMode = input.certificateMode ?? "system";
  assert(
    (CERTIFICATE_MODES as readonly string[]).includes(certificateMode),
    "Invalid certificate mode.",
  );

  if (input.pinnedFingerprint !== undefined) {
    assert(
      FINGERPRINT_PATTERN.test(input.pinnedFingerprint),
      "Invalid pinned certificate fingerprint.",
    );
  }

  return {
    name,
    protocol,
    host,
    port,
    connectionMode,
    certificateMode,
    pinnedFingerprint: input.pinnedFingerprint,
    autoConnect: input.autoConnect ?? false,
  };
}
