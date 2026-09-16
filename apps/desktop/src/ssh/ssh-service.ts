import { createHash, randomUUID } from "node:crypto";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import { ConfigStore } from "../storage/config-store";
import type { SshProfileManager } from "./ssh-profile-manager";
import type {
  SshConnectInput,
  SshConnectionStatus,
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

  async connect(input: SshConnectInput): Promise<{ sessionId: string }> {
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

    const cols = Math.max(20, Math.min(500, Math.floor(Number(input.cols) || 80)));
    const rows = Math.max(5, Math.min(300, Math.floor(Number(input.rows) || 24)));
    const sessionId = randomUUID();
    const client = new Client();
    this.emitStatus(profile.id, "connecting", sessionId);

    const knownHosts = await this.config.readJson<Record<string, string>>(KNOWN_HOSTS_FILE, {});
    const hostKey = `${profile.host.toLowerCase()}:${profile.port}`;

    return new Promise<{ sessionId: string }>((resolve, reject) => {
      let settled = false;
      let hadError = false;
      const fail = (err: Error): void => {
        hadError = true;
        const message = err.message || "SSH connection failed.";
        this.emitStatus(profile.id, "error", sessionId, message);
        if (!settled) {
          settled = true;
          const code = /auth|password|private key/i.test(message)
            ? ErrorCode.AUTH_ERROR
            : ErrorCode.NETWORK_ERROR;
          reject(new SshError(message, code));
        }
      };

      const connectConfig: ConnectConfig = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        hostVerifier: (key: Buffer, verify: (verified: boolean) => void): void => {
          const fingerprint = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          const previousFingerprint = knownHosts[hostKey];
          if (previousFingerprint === fingerprint) {
            verify(true);
            return;
          }
          void this.promptHostKey({
            profileId: profile.id,
            profileName: profile.name,
            host: profile.host,
            port: profile.port,
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
        ...(profile.authType === "password"
          ? { password: credential }
          : { privateKey: credential, passphrase: passphrase || undefined }),
      };

      client
        .once("ready", () => {
          client.shell({ term: "xterm-256color", cols, rows }, (err, stream) => {
            if (err) {
              client.end();
              fail(err);
              return;
            }
            this.sessions.set(sessionId, { profileId: profile.id, client, stream });
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
            this.emitStatus(profile.id, "connected", sessionId);
            resolve({ sessionId });
          });
        })
        .on("error", fail)
        .once("close", () => {
          this.sessions.delete(sessionId);
          if (!hadError) this.emitStatus(profile.id, "disconnected", sessionId);
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
