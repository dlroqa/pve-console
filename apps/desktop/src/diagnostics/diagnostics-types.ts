/**
 * Diagnostics types (spec §15).
 */

import type { CertificateInfo } from "../certificates/certificate-types";
import type { ErrorCode } from "../shared/types";

export type DiagnosticStatus = "pass" | "fail" | "warn" | "skipped";

export type DiagnosticId =
  | "host"
  | "dns"
  | "tcp"
  | "tls"
  | "certificate"
  | "https"
  | "proxmox"
  | "websocket"
  | "latency";

export interface DiagnosticResult {
  id: DiagnosticId;
  label: string;
  status: DiagnosticStatus;
  /** Short human-readable summary of the result. */
  message: string;
  /** Likely causes on failure — never presented as certainty (spec §15). */
  possibleCauses?: string[];
  errorCode?: ErrorCode;
  /** Measured latency in milliseconds, where applicable. */
  latencyMs?: number;
  /** Populated by the certificate inspection step. */
  certificate?: CertificateInfo;
}

export interface DiagnosticsTarget {
  serverProfileId?: string;
  protocol: "https" | "http";
  host: string;
  port: number;
}

export interface DiagnosticsReport {
  target: DiagnosticsTarget;
  baseUrl: string;
  startedAt: string;
  finishedAt: string;
  results: DiagnosticResult[];
  /** Overall roll-up: proxmox detected and reachable. */
  proxmoxDetected: boolean;
}
