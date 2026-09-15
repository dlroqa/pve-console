/**
 * Secret storage (spec §6.3, §37).
 *
 * Sensitive values (API token secrets added in later phases) are encrypted
 * through Electron `safeStorage`, which is backed by the OS credential
 * mechanism (Keychain / DPAPI / libsecret). Ciphertext is stored in a
 * separate file from normal config; plaintext secrets are never persisted.
 *
 * This interface is deliberately small and is NOT wired into any Version 1
 * feature — it exists so later phases (native API tokens) can store secrets
 * safely. It must never be merged with config-store.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { safeStorage } from "electron";
import { logger } from "../shared/logger";

interface SecretFile {
  /** Map of key -> base64 ciphertext produced by safeStorage. */
  entries: Record<string, string>;
}

export class SecretStore {
  private readonly file: string;

  constructor(baseDir: string) {
    this.file = join(baseDir, "secrets.enc.json");
  }

  /** Whether OS-backed encryption is currently available. */
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private async load(): Promise<SecretFile> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return JSON.parse(raw) as SecretFile;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return { entries: {} };
      throw err;
    }
  }

  private async persist(data: SecretFile): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(tmp, this.file);
  }

  async setSecret(key: string, plaintext: string): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("OS secret encryption is not available on this system.");
    }
    const cipher = safeStorage.encryptString(plaintext);
    const data = await this.load();
    data.entries[key] = cipher.toString("base64");
    await this.persist(data);
    logger.info({ module: "secret-store", event: "secret-set", detail: { key } });
  }

  async getSecret(key: string): Promise<string | undefined> {
    if (!this.isAvailable()) return undefined;
    const data = await this.load();
    const b64 = data.entries[key];
    if (!b64) return undefined;
    return safeStorage.decryptString(Buffer.from(b64, "base64"));
  }

  async deleteSecret(key: string): Promise<void> {
    const data = await this.load();
    if (key in data.entries) {
      delete data.entries[key];
      await this.persist(data);
      logger.info({ module: "secret-store", event: "secret-deleted", detail: { key } });
    }
  }
}
