/**
 * Server profile manager (spec §3.3).
 *
 * CRUD operations over server profiles, persisted via ConfigStore. Profiles
 * are validated on the way in and out and can never carry secrets.
 *
 * Duplicate names are allowed as long as ids differ (spec Phase 3 acceptance).
 */

import { randomBytes } from "node:crypto";
import { ConfigStore } from "../storage/config-store";
import {
  validateProfile,
  normalizeCreateInput,
  ProfileValidationError,
} from "./profile-schema";
import type {
  ServerProfile,
  CreateServerProfileInput,
  UpdateServerProfileInput,
} from "./profile-types";

const PROFILES_FILE = "profiles";

function newId(): string {
  // 12 lowercase hex chars — matches the id schema and is collision-resistant.
  return randomBytes(6).toString("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ProfileManager {
  constructor(private readonly store: ConfigStore) {}

  async list(): Promise<ServerProfile[]> {
    const profiles = await this.store.readJson<ServerProfile[]>(PROFILES_FILE, []);
    // Validate defensively; skip and log anything corrupt rather than crashing.
    const valid: ServerProfile[] = [];
    for (const p of profiles) {
      try {
        validateProfile(p);
        valid.push(p);
      } catch {
        // Corrupt entry — ignored on read.
      }
    }
    return valid;
  }

  async get(id: string): Promise<ServerProfile | undefined> {
    const all = await this.list();
    return all.find((p) => p.id === id);
  }

  async create(input: CreateServerProfileInput): Promise<ServerProfile> {
    const normalized = normalizeCreateInput(input);
    const ts = nowIso();
    const profile: ServerProfile = {
      id: newId(),
      ...normalized,
      createdAt: ts,
      updatedAt: ts,
    };
    validateProfile(profile);

    const all = await this.list();
    all.push(profile);
    await this.store.writeJson(PROFILES_FILE, all);
    return profile;
  }

  async update(id: string, patch: UpdateServerProfileInput): Promise<ServerProfile> {
    const all = await this.list();
    const idx = all.findIndex((p) => p.id === id);
    if (idx === -1) throw new ProfileValidationError(`No profile with id "${id}".`);

    // Merge, then re-validate. id/createdAt are immutable; updatedAt is bumped.
    const merged: ServerProfile = {
      ...all[idx],
      ...patch,
      id: all[idx].id,
      createdAt: all[idx].createdAt,
      updatedAt: nowIso(),
    };
    validateProfile(merged);

    all[idx] = merged;
    await this.store.writeJson(PROFILES_FILE, all);
    return merged;
  }

  async delete(id: string): Promise<void> {
    const all = await this.list();
    const next = all.filter((p) => p.id !== id);
    if (next.length === all.length) {
      throw new ProfileValidationError(`No profile with id "${id}".`);
    }
    await this.store.writeJson(PROFILES_FILE, next);
  }
}
