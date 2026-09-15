/**
 * Shared type definitions used by both the trusted main process and the
 * React renderer. These describe the IPC contract and cross-cutting models.
 */

import type { PROTOCOLS, CONNECTION_MODES, CERTIFICATE_MODES } from "./constants";

export type Protocol = (typeof PROTOCOLS)[number];
export type ConnectionMode = (typeof CONNECTION_MODES)[number];
export type CertificateMode = (typeof CERTIFICATE_MODES)[number];

/**
 * Structured error categories (spec §20). User-facing errors are mapped to one
 * of these so the UI can render understandable messages.
 */
export enum ErrorCode {
  NETWORK_ERROR = "NETWORK_ERROR",
  DNS_ERROR = "DNS_ERROR",
  TCP_ERROR = "TCP_ERROR",
  TLS_ERROR = "TLS_ERROR",
  CERTIFICATE_MISMATCH = "CERTIFICATE_MISMATCH",
  HTTP_ERROR = "HTTP_ERROR",
  PROXMOX_NOT_DETECTED = "PROXMOX_NOT_DETECTED",
  AUTH_ERROR = "AUTH_ERROR",
  API_PERMISSION_ERROR = "API_PERMISSION_ERROR",
  WEBSOCKET_ERROR = "WEBSOCKET_ERROR",
  PROFILE_ERROR = "PROFILE_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

/** A structured, serializable application error passed across IPC. */
export interface AppError {
  code: ErrorCode;
  message: string;
  /** Optional likely causes shown to the user; never presented as certainty. */
  possibleCauses?: string[];
  /** Non-secret detail, only surfaced when developer diagnostics are enabled. */
  detail?: string;
}

/**
 * Explicit connection state machine (spec §32). Avoids ambiguous booleans.
 */
export enum ConnectionState {
  IDLE = "IDLE",
  VALIDATING = "VALIDATING",
  CONNECTING = "CONNECTING",
  CERTIFICATE_REVIEW = "CERTIFICATE_REVIEW",
  CONNECTED = "CONNECTED",
  DISCONNECTED = "DISCONNECTED",
  ERROR = "ERROR",
}

/** Server status shown in the sidebar (spec §8.3, §34). */
export type ServerStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "certificate-warning"
  | "offline";

/** Application settings model (spec §23). */
export interface AppSettings {
  theme: "system" | "light" | "dark";
  openExternalLinksInSystemBrowser: boolean;
  defaultDownloadDirectory?: string;
  enableDeveloperDiagnostics: boolean;
  logLevel: "error" | "warn" | "info" | "debug";
  rememberServerSessions: boolean;
}

/** Generic result wrapper for IPC handlers. */
export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppError };
