/**
 * Certificate trust manager (spec §5, §14).
 *
 * Responsibilities:
 *  - persist certificate pins bound to (profile id, host, port);
 *  - hold runtime-only "trust once" decisions;
 *  - evaluate an observed certificate: trusted / unknown / mismatch;
 *  - never automatically replace a pin on mismatch (spec §14.4);
 *  - never perform a global TLS bypass (spec §0.2, §14).
 */

import { ConfigStore } from "../storage/config-store";
import { fingerprintsEqual, normalizeFingerprint } from "./fingerprint";
import type {
  CertificateInfo,
  CertificatePin,
  CertificateEvaluation,
} from "./certificate-types";

const PINS_FILE = "certificate-pins";

function pinKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

export class CertificateManager {
  /** Runtime-only "trust once" set, keyed by host:port -> fingerprint. */
  private readonly trustedOnce = new Map<string, string>();

  constructor(private readonly store: ConfigStore) {}

  async listPins(): Promise<CertificatePin[]> {
    return this.store.readJson<CertificatePin[]>(PINS_FILE, []);
  }

  async getPin(host: string, port: number): Promise<CertificatePin | undefined> {
    const pins = await this.listPins();
    return pins.find((p) => pinKey(p.host, p.port) === pinKey(host, port));
  }

  /** Trust only for the current runtime/session (spec §5.2, §14.2). */
  trustOnce(host: string, port: number, fingerprint: string): void {
    this.trustedOnce.set(pinKey(host, port), normalizeFingerprint(fingerprint));
  }

  isTrustedOnce(host: string, port: number, fingerprint: string): boolean {
    const fp = this.trustedOnce.get(pinKey(host, port));
    return fp !== undefined && fingerprintsEqual(fp, fingerprint);
  }

  /** Persist a pin bound to profile id, host, port (spec §5.3, §14.3). */
  async pin(
    serverProfileId: string,
    host: string,
    port: number,
    fingerprint: string,
  ): Promise<CertificatePin> {
    const record: CertificatePin = {
      serverProfileId,
      host,
      port,
      fingerprintSha256: normalizeFingerprint(fingerprint),
      approvedAt: new Date().toISOString(),
    };
    const pins = await this.listPins();
    const idx = pins.findIndex((p) => pinKey(p.host, p.port) === pinKey(host, port));
    if (idx === -1) pins.push(record);
    else pins[idx] = record;
    await this.store.writeJson(PINS_FILE, pins);
    return record;
  }

  /** Explicitly replace a pin (only after user confirmation, spec §14.4). */
  async replacePin(
    serverProfileId: string,
    host: string,
    port: number,
    fingerprint: string,
  ): Promise<CertificatePin> {
    return this.pin(serverProfileId, host, port, fingerprint);
  }

  async removePinForProfile(serverProfileId: string): Promise<void> {
    const pins = await this.listPins();
    const next = pins.filter((p) => p.serverProfileId !== serverProfileId);
    if (next.length !== pins.length) {
      await this.store.writeJson(PINS_FILE, next);
    }
  }

  /**
   * Evaluate an observed certificate against stored trust.
   * Mismatch blocks automatically; the caller must not proceed without an
   * explicit user "replace-pin" decision.
   */
  async evaluate(
    observed: CertificateInfo,
    certificateMode: "system" | "pinned" | "trust-once",
  ): Promise<CertificateEvaluation> {
    const { host, port, fingerprintSha256 } = observed;

    const pin = await this.getPin(host, port);
    if (pin) {
      if (fingerprintsEqual(pin.fingerprintSha256, fingerprintSha256)) {
        return { status: "trusted-pinned" };
      }
      return {
        status: "mismatch",
        observed,
        previousFingerprint: pin.fingerprintSha256,
      };
    }

    if (this.isTrustedOnce(host, port, fingerprintSha256)) {
      return { status: "trusted-once" };
    }

    // No pin and no runtime trust. In "system" mode the OS trust store may
    // still validate a properly-signed certificate; the caller decides based
    // on the underlying TLS validation result. For self-signed servers this
    // surfaces as "unknown" so the user is prompted.
    if (certificateMode === "system") {
      return { status: "unknown", observed };
    }

    return { status: "unknown", observed };
  }
}
