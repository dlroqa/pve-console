import type { ServerStatus } from "../shared/types";
import type { CertificateInfo } from "../certificates/certificate-types";

export interface CertificatePromptPayload {
  requestId: string;
  profileId: string;
  profileName: string;
  host: string;
  port: number;
  status: "unknown" | "mismatch";
  observed: CertificateInfo;
  previousFingerprint?: string;
}

export type Route =
  | { name: "home" }
  | { name: "workspace"; serverId: string }
  | { name: "add" }
  | { name: "edit"; serverId: string }
  | { name: "terminal-session"; terminalId: string }
  | { name: "diagnostics"; serverId?: string }
  | { name: "settings" };

export type StatusMap = Record<string, ServerStatus>;
