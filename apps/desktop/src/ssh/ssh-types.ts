export type SshAuthType = "password" | "private-key";

/** Non-secret SSH connection metadata persisted in the normal config store. */
export interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasCredential: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSshProfileInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  authType: SshAuthType;
  credential?: string;
  passphrase?: string;
  rememberCredential?: boolean;
}

export interface UpdateSshProfileInput {
  name: string;
}

export interface SshConnectInput {
  profileId: string;
  credential?: string;
  passphrase?: string;
  cols: number;
  rows: number;
}

export interface SshDirectConnectInput {
  targetId: string;
  name?: string;
  host: string;
  port?: number;
  username: string;
  authType: SshAuthType;
  credential: string;
  passphrase?: string;
  cols: number;
  rows: number;
}

export interface SshConnectResult {
  sessionId: string;
  profileId: string;
}

export type SshConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface SshHostKeyPrompt {
  requestId: string;
  profileId: string;
  profileName: string;
  host: string;
  port: number;
  fingerprint: string;
  previousFingerprint?: string;
}

export type SshHostKeyDecision = "cancel" | "trust-once" | "trust-and-save";
