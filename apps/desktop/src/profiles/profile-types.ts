/**
 * Strongly typed server profile model (spec §7).
 *
 * IMPORTANT: A server profile MUST NOT contain any plaintext secret
 * (root password, user password, API secret, session password). See
 * profile-schema.ts which enforces this.
 */

import type { Protocol, ConnectionMode, CertificateMode } from "../shared/types";

export interface ServerProfile {
  id: string;
  name: string;

  protocol: Protocol;
  host: string;
  port: number;

  connectionMode: ConnectionMode;

  certificateMode: CertificateMode;

  pinnedFingerprint?: string;

  autoConnect: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a profile (server generates id/timestamps). */
export interface CreateServerProfileInput {
  name: string;
  protocol?: Protocol;
  host: string;
  port?: number;
  connectionMode?: ConnectionMode;
  certificateMode?: CertificateMode;
  pinnedFingerprint?: string;
  autoConnect?: boolean;
}

/** Fields accepted when updating a profile. */
export type UpdateServerProfileInput = Partial<
  Omit<ServerProfile, "id" | "createdAt" | "updatedAt">
>;
