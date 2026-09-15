import { describe, it, expect } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "../../src/shared/settings";

describe("settings validation (spec §23)", () => {
  it("returns defaults for empty input", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("coerces invalid values back to defaults", () => {
    const out = normalizeSettings({ theme: "neon", logLevel: "loud", rememberServerSessions: "yes" });
    expect(out.theme).toBe("system");
    expect(out.logLevel).toBe("info");
    expect(out.rememberServerSessions).toBe(true);
  });

  it("preserves valid values", () => {
    const out = normalizeSettings({
      theme: "dark",
      openExternalLinksInSystemBrowser: false,
      enableDeveloperDiagnostics: true,
      logLevel: "debug",
      rememberServerSessions: false,
      defaultDownloadDirectory: "/tmp/dl",
    });
    expect(out).toEqual({
      theme: "dark",
      openExternalLinksInSystemBrowser: false,
      enableDeveloperDiagnostics: true,
      logLevel: "debug",
      rememberServerSessions: false,
      defaultDownloadDirectory: "/tmp/dl",
    });
  });

  it("drops empty download directory", () => {
    expect(normalizeSettings({ defaultDownloadDirectory: "" }).defaultDownloadDirectory).toBeUndefined();
  });
});
