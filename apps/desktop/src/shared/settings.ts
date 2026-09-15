/**
 * Application settings defaults and validation (spec §23).
 */

import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  openExternalLinksInSystemBrowser: true,
  enableDeveloperDiagnostics: false,
  logLevel: "info",
  rememberServerSessions: true,
};

const THEMES = ["system", "light", "dark"] as const;
const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;

/** Coerce an unknown value into a valid AppSettings, falling back to defaults. */
export function normalizeSettings(input: unknown): AppSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    theme: (THEMES as readonly string[]).includes(src.theme as string)
      ? (src.theme as AppSettings["theme"])
      : DEFAULT_SETTINGS.theme,
    openExternalLinksInSystemBrowser:
      typeof src.openExternalLinksInSystemBrowser === "boolean"
        ? src.openExternalLinksInSystemBrowser
        : DEFAULT_SETTINGS.openExternalLinksInSystemBrowser,
    defaultDownloadDirectory:
      typeof src.defaultDownloadDirectory === "string" && src.defaultDownloadDirectory.length > 0
        ? src.defaultDownloadDirectory
        : undefined,
    enableDeveloperDiagnostics:
      typeof src.enableDeveloperDiagnostics === "boolean"
        ? src.enableDeveloperDiagnostics
        : DEFAULT_SETTINGS.enableDeveloperDiagnostics,
    logLevel: (LOG_LEVELS as readonly string[]).includes(src.logLevel as string)
      ? (src.logLevel as AppSettings["logLevel"])
      : DEFAULT_SETTINGS.logLevel,
    rememberServerSessions:
      typeof src.rememberServerSessions === "boolean"
        ? src.rememberServerSessions
        : DEFAULT_SETTINGS.rememberServerSessions,
  };
}
