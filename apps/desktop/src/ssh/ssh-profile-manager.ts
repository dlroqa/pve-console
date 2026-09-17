import { randomBytes } from "node:crypto";
import { ConfigStore } from "../storage/config-store";
import { SecretStore } from "../storage/secret-store";
import type { CreateSshProfileInput, SshAuthType, SshProfile } from "./ssh-types";
import { ErrorCode } from "../shared/types";
import { SshError } from "./ssh-error";
import { logger } from "../shared/logger";

const SSH_PROFILES_FILE = "ssh-profiles";
const SSH_SECRET_PREFIX = "ssh:";

type StoredSshProfile = Omit<SshProfile, "hasCredential">;

export interface SshCredential {
  credential: string;
  passphrase?: string;
}

function validateText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new SshError(`${label} is required.`, ErrorCode.PROFILE_ERROR);
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

export class SshProfileManager {
  constructor(
    private readonly config: ConfigStore,
    private readonly secrets: SecretStore,
  ) {}

  private secretKey(id: string): string {
    return `${SSH_SECRET_PREFIX}${id}`;
  }

  private async storedProfiles(): Promise<StoredSshProfile[]> {
    return this.config.readJson<StoredSshProfile[]>(SSH_PROFILES_FILE, []);
  }

  private async publicProfile(profile: StoredSshProfile): Promise<SshProfile> {
    return {
      ...profile,
      hasCredential: Boolean(await this.secrets.getSecret(this.secretKey(profile.id))),
    };
  }

  async list(): Promise<SshProfile[]> {
    const profiles = await this.storedProfiles();
    return Promise.all(profiles.map((profile) => this.publicProfile(profile)));
  }

  async get(id: string): Promise<SshProfile | undefined> {
    const profile = (await this.storedProfiles()).find((item) => item.id === id);
    return profile ? this.publicProfile(profile) : undefined;
  }

  async create(input: CreateSshProfileInput): Promise<SshProfile> {
    if (!input || typeof input !== "object") throw new SshError("SSH connection details are required.", ErrorCode.PROFILE_ERROR);
    const authType = validateAuthType(input.authType);
    const credential = typeof input.credential === "string" ? input.credential : "";
    if (input.rememberCredential && !credential) {
      throw new SshError(
        authType === "password" ? "Password is required." : "Private key is required.",
        ErrorCode.PROFILE_ERROR,
      );
    }

    const timestamp = new Date().toISOString();
    const profile: StoredSshProfile = {
      id: randomBytes(6).toString("hex"),
      name: validateText(input.name, "Name", 80),
      host: validateText(input.host, "Host", 253),
      port: validatePort(input.port),
      username: validateText(input.username, "Username", 128),
      authType,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const profiles = await this.storedProfiles();
    profiles.push(profile);
    await this.config.writeJson(SSH_PROFILES_FILE, profiles);

    if (input.rememberCredential && credential) {
      try {
        await this.secrets.setSecret(
          this.secretKey(profile.id),
          JSON.stringify({ credential, passphrase: input.passphrase || undefined }),
        );
      } catch (error) {
        logger.warn({
          module: "ssh-profile-manager",
          event: "credential-not-saved",
          detail: {
            profileId: profile.id,
            message: error instanceof Error ? error.message : "Credential encryption failed.",
          },
        });
      }
    }
    return this.publicProfile(profile);
  }

  async getCredential(id: string): Promise<SshCredential | undefined> {
    const raw = await this.secrets.getSecret(this.secretKey(id));
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as SshCredential;
      return typeof value.credential === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async delete(id: string): Promise<void> {
    const profiles = await this.storedProfiles();
    const next = profiles.filter((profile) => profile.id !== id);
    if (next.length === profiles.length) throw new SshError("SSH connection not found.", ErrorCode.PROFILE_ERROR);
    await this.config.writeJson(SSH_PROFILES_FILE, next);
    await this.secrets.deleteSecret(this.secretKey(id));
  }
}
