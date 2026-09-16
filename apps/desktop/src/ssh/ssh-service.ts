import { createHash, randomUUID } from "node:crypto";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { ConfigStore } from "../storage/config-store";
import type { SshProfileManager } from "./ssh-profile-manager";
import type {
  SshAuthType,
  SshConnectInput,
  SshConnectResult,
  SshConnectionStatus,
  SshDirectConnectInput,
  SshHostKeyDecision,
  SshHostKeyPrompt,
} from "./ssh-types";
import { ErrorCode } from "../shared/types";
import { SshError } from "./ssh-error";

const KNOWN_HOSTS_FILE = "ssh-known-hosts";

type Emit = (channel: string, payload: unknown) => void;
type PromptHostKey = (prompt: Omit<SshHostKeyPrompt, "requestId">) => Promise<SshHostKeyDecision>;

interface ActiveSession {
  profileId: string;
  client: Client;
  stream: ClientChannel;
}

interface SshTarget {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
}

function validateText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SshError(`${label} is required.`, ErrorCode.PROFILE_ERROR);
  }
  const normalized = value.trim();
  if (normalized.length > max) throw new SshError(`${label} is too long.`, ErrorCode.PROFILE_ERROR);
  return normalized;
}

function validatePort(value: unknown): number {
  const port = value === undefined ? 22 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SshError("SSH port must be between 1 and 65535.", ErrorCode.PROFILE_ERROR);
  }
  return port;
}

function validateAuthType(value: unknown): SshAuthType {
  if (value !== "password" && value !== "private-key") {
    throw new SshError("Choose password or private-key authentication.", ErrorCode.PROFILE_ERROR);
  }
  return value;
}

function terminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.min(500, Math.floor(Number(cols) || 80))),
    rows: Math.max(5, Math.min(300, Math.floor(Number(rows) || 24))),
  };
}

export class SshService {
  private readonly sessions = new Map<string, ActiveSession>();

  constructor(
    private readonly profiles: SshProfileManager,
    private readonly config: ConfigStore,
    private readonly emit: Emit,
    private readonly promptHostKey: PromptHostKey,
  ) {}

  private emitStatus(
    profileId: string,
    status: SshConnectionStatus,
    sessionId?: string,
    message?: string,
  ): void {
    this.emit("terminal:status", { profileId, sessionId, status, message });
  }

  async connect(input: SshConnectInput): Promise<SshConnectResult> {
    const profile = await this.profiles.get(String(input.profileId));
    if (!profile) throw new SshError("SSH connection not found.", ErrorCode.PROFILE_ERROR);

    const saved = await this.profiles.getCredential(profile.id);
    const credential = input.credential || saved?.credential;
    const passphrase = input.passphrase || saved?.passphrase;
    if (!credential) {
      throw new SshError(
        profile.authType === "password" ? "Enter the SSH password." : "Enter the private key.",
        ErrorCode.AUTH_ERROR,
      );
    }

    return this.connectTarget(profile, credential, passphrase, terminalSize(input.cols, input.rows));
  }

  async connectDirect(input: SshDirectConnectInput): Promise<SshConnectResult> {
    const authType = validateAuthType(input.authType);
    const credential = typeof input.credential === "string" ? input.credential : "";
    if (!credential) {
      throw new SshError(
        authType === "password" ? "Enter the SSH password." : "Enter the private key.",
        ErrorCode.AUTH_ERROR,
      );
    }

    const host = validateText(input.host, "Host", 253);
    const username = validateText(input.username, "Username", 128);
    const target: SshTarget = {
      id: validateText(input.targetId, "Terminal id", 80),
      name: input.name?.trim() || `${username}@${host}`,
      host,
      port: validatePort(input.port),
      username,
      authType,
    };

    return this.connectTarget(target, credential, input.passphrase, terminalSize(input.cols, input.rows));
  }

  private async connectTarget(
    target: SshTarget,
    credential: string,
    passphrase: string | undefined,
    size: { cols: number; rows: number },
  ): Promise<SshConnectResult> {
    const sessionId = randomUUID();
    const client = new Client();
    this.emitStatus(target.id, "connecting", sessionId);

    const knownHosts = await this.config.readJson<Record<string, string>>(KNOWN_HOSTS_FILE, {});
    const hostKey = `${target.host.toLowerCase()}:${target.port}`;

    return new Promise<SshConnectResult>((resolve, reject) => {
      let settled = false;
      let hadError = false;
      const fail = (err: Error): void => {
        hadError = true;
        const message = err.message || "SSH connection failed.";
        this.emitStatus(target.id, "error", sessionId, message);
        if (!settled) {
          settled = true;
          const code = /auth|password|private key/i.test(message)
            ? ErrorCode.AUTH_ERROR
            : ErrorCode.NETWORK_ERROR;
          reject(new SshError(message, code));
        }
      };

      const connectConfig: ConnectConfig = {
        host: target.host,
        port: target.port,
        username: target.username,
        hostVerifier: (key: Buffer, verify: (verified: boolean) => void): void => {
          const fingerprint = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          const previousFingerprint = knownHosts[hostKey];
          if (previousFingerprint === fingerprint) {
            verify(true);
            return;
          }
          void this.promptHostKey({
            profileId: target.id,
            profileName: target.name,
            host: target.host,
            port: target.port,
            fingerprint: `SHA256:${fingerprint}`,
            previousFingerprint: previousFingerprint ? `SHA256:${previousFingerprint}` : undefined,
          })
            .then(async (decision) => {
              if (decision === "trust-and-save") {
                knownHosts[hostKey] = fingerprint;
                await this.config.writeJson(KNOWN_HOSTS_FILE, knownHosts);
              }
              verify(decision !== "cancel");
            })
            .catch(() => verify(false));
        },
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
        readyTimeout: 20_000,
        ...(target.authType === "password"
          ? { password: credential }
          : { privateKey: credential, passphrase: passphrase || undefined }),
      };

      client
        .once("ready", () => {
          client.shell({ term: "xterm-256color", cols: size.cols, rows: size.rows }, (err, stream) => {
            if (err) {
              client.end();
              fail(err);
              return;
            }
            this.sessions.set(sessionId, { profileId: target.id, client, stream });
            stream.on("data", (data: Buffer) => {
              this.emit("terminal:data", { sessionId, data: data.toString("utf8") });
            });
            stream.stderr.on("data", (data: Buffer) => {
              this.emit("terminal:data", { sessionId, data: data.toString("utf8") });
            });
            stream.once("close", () => {
              this.sessions.delete(sessionId);
              client.end();
            });
            settled = true;
            this.emitStatus(target.id, "connected", sessionId);
            resolve({ sessionId, profileId: target.id });
          });
        })
        .on("error", fail)
        .once("close", () => {
          this.sessions.delete(sessionId);
          if (!hadError) this.emitStatus(target.id, "disconnected", sessionId);
          if (!settled) {
            settled = true;
            reject(new SshError("SSH connection closed before the shell was ready."));
          }
        })
        .connect(connectConfig);
    });
  }

  write(sessionId: string, data: string): void {
    if (typeof data !== "string" || data.length > 64 * 1024) throw new SshError("Invalid terminal input.");
    const session = this.sessions.get(sessionId);
    if (!session) throw new SshError("Terminal session is not connected.");
    session.stream.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const safeCols = Math.max(20, Math.min(500, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(300, Math.floor(rows)));
    session.stream.setWindow(safeRows, safeCols, 0, 0);
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.stream.end();
    session.client.end();
    this.emitStatus(session.profileId, "disconnected", sessionId);
  }

  disconnectProfile(profileId: string): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.profileId === profileId) this.disconnect(sessionId);
    }
  }

  disconnectAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disconnect(sessionId);
  }
}
