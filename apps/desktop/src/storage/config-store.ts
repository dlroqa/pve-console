/**
 * Non-secret configuration storage (spec §37).
 *
 * Holds server profiles and normal settings as JSON files. This store must
 * NEVER contain credentials/tokens — those go through secret-store.ts.
 *
 * Writes are atomic (write to a temp file, then rename) to avoid corrupting
 * config on crash. The base directory is injected so the store is testable
 * without Electron.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { logger } from "../shared/logger";

export class ConfigStore {
  constructor(private readonly baseDir: string) {}

  private fileFor(name: string): string {
    return join(this.baseDir, `${name}.json`);
  }

  async readJson<T>(name: string, fallback: T): Promise<T> {
    const file = this.fileFor(name);
    try {
      const raw = await fs.readFile(file, "utf8");
      return JSON.parse(raw) as T;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return fallback;
      logger.error({
        module: "config-store",
        event: "read-failed",
        detail: { name, code: e.code },
      });
      throw err;
    }
  }

  async writeJson<T>(name: string, value: T): Promise<void> {
    const file = this.fileFor(name);
    await fs.mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    const data = JSON.stringify(value, null, 2);
    await fs.writeFile(tmp, data, { encoding: "utf8", mode: 0o600 });
    await fs.rename(tmp, file);
    logger.debug({ module: "config-store", event: "write", detail: { name } });
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(this.fileFor(name));
      return true;
    } catch {
      return false;
    }
  }
}
