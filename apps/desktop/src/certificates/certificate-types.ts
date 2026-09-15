/**
 * Certificate handling types (spec §14, §5).
 */

export interface CertificateInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  /** Normalized SHA-256 fingerprint, colon-separated uppercase hex. */
  fingerprintSha256: string;
  /** The server this certificate was observed for. */
  host: string;
  port: number;
}

/** A persisted certificate pin (spec §14.3). */
export interface CertificatePin {
  serverProfileId: string;
  host: string;
  port: number;
  fingerprintSha256: string;
  approvedAt: string;
}

/** Result of evaluating an observed certificate against stored trust. */
export type CertificateEvaluation =
  | { status: "trusted-pinned" }
  | { status: "trusted-once" }
  | { status: "system-trusted" }
  | { status: "unknown"; observed: CertificateInfo }
  | {
      status: "mismatch";
      observed: CertificateInfo;
      previousFingerprint: string;
    };

/** User decision from the certificate dialog. */
export type CertificateDecision =
  | "cancel"
  | "trust-once"
  | "trust-and-pin"
  | "replace-pin";
