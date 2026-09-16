/**
 * Session manager (spec §9, §6).
 *
 * Gives every Proxmox server its own isolated persistent Electron session
 * (persist:pve-{serverId}). Cookies, cache and auth state never cross between
 * servers. Each session installs a certificate verification procedure that
 * enforces pinning / explicit trust WITHOUT any global TLS bypass (spec §14).
 */

import { session as electronSession, type Session } from "electron";
import { sessionPartitionFor } from "../shared/constants";
import { fingerprintFromDer } from "../certificates/fingerprint";
import { logger } from "../shared/logger";
import type { CertificateManager } from "../certificates/certificate-manager";
import type {
  CertificateInfo,
  CertificateDecision,
  CertificateEvaluation,
} from "../certificates/certificate-types";
import type { ServerProfile } from "../profiles/profile-types";

export type CertificatePrompt = (args: {
  profile: ServerProfile;
  evaluation: Extract<CertificateEvaluation, { status: "unknown" } | { status: "mismatch" }>;
}) => Promise<CertificateDecision>;

function pemToDer(pem: string): Buffer {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(base64, "base64");
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private onCertificateResult: ((profileId: string, accepted: boolean) => void) | null = null;
  /** De-duplicate concurrent certificate prompts per host:port. */
  private readonly inFlightPrompts = new Map<string, Promise<CertificateDecision>>();

  constructor(
    private readonly certManager: CertificateManager,
    private readonly prompt: CertificatePrompt,
    private readonly onStatus?: (profileId: string, warning: boolean) => void,
  ) {}

  /**
   * Called after Electron has received a certificate verdict. This lets the
   * view manager restart a navigation that may have expired during user review.
   */
  setCertificateResultHandler(
    handler: (profileId: string, accepted: boolean) => void,
  ): void {
    this.onCertificateResult = handler;
  }

  private notifyCertificateResult(profileId: string, accepted: boolean): void {
    try {
      this.onCertificateResult?.(profileId, accepted);
    } catch (err) {
      logger.error({
        module: "session",
        event: "cert-result-handler-error",
        serverProfileId: profileId,
        detail: { message: (err as Error).message },
      });
    }
  }

  /** Return (creating if needed) the isolated session for a profile. */
  getSession(profile: ServerProfile): Session {
    const existing = this.sessions.get(profile.id);
    if (existing) return existing;

    const partition = sessionPartitionFor(profile.id);
    const ses = electronSession.fromPartition(partition);
    this.installCertificateProc(ses, profile);
    this.sessions.set(profile.id, ses);
    logger.info({
      module: "session",
      event: "session-created",
      serverProfileId: profile.id,
      detail: { partition },
    });
    return ses;
  }

  private hostKey(profile: ServerProfile): string {
    return `${profile.host.toLowerCase()}:${profile.port}`;
  }

  private installCertificateProc(ses: Session, profile: ServerProfile): void {
    ses.setCertificateVerifyProc((request, callback) => {
      // callback(0) => trust, callback(-2) => reject, callback(-3) => default.
      void this.evaluateCertificate(profile, request).then(
        (verdict) => {
          callback(verdict);
          this.notifyCertificateResult(profile.id, verdict === 0);
        },
        (err) => {
          logger.error({
            module: "session",
            event: "cert-proc-error",
            serverProfileId: profile.id,
            detail: { message: (err as Error).message },
          });
          callback(-2);
          this.notifyCertificateResult(profile.id, false);
        },
      );
    });
  }

  private async evaluateCertificate(
    profile: ServerProfile,
    request: {
      hostname: string;
      certificate: {
        data: string;
        subjectName?: string;
        issuerName?: string;
        validStart?: number;
        validExpiry?: number;
      };
      errorCode: number;
    },
  ): Promise<number> {
    let der: Buffer;
    try {
      der = pemToDer(request.certificate.data);
    } catch {
      return -2;
    }
    const cert = request.certificate;
    const asIso = (epochSeconds?: number): string =>
      typeof epochSeconds === "number" ? new Date(epochSeconds * 1000).toISOString() : "";
    const observed: CertificateInfo = {
      subject: cert.subjectName ?? "",
      issuer: cert.issuerName ?? "",
      validFrom: asIso(cert.validStart),
      validTo: asIso(cert.validExpiry),
      fingerprintSha256: fingerprintFromDer(der),
      host: profile.host,
      port: profile.port,
    };

    const evaluation = await this.certManager.evaluate(observed, profile.certificateMode);

    switch (evaluation.status) {
      case "trusted-pinned":
      case "trusted-once":
        this.onStatus?.(profile.id, false);
        return 0;

      case "mismatch": {
        // Block automatically; only an explicit user decision may replace.
        this.onStatus?.(profile.id, true);
        logger.warn({
          module: "session",
          event: "certificate-mismatch",
          serverProfileId: profile.id,
        });
        const decision = await this.promptOnce(profile, evaluation);
        if (decision === "replace-pin") {
          await this.certManager.replacePin(
            profile.id,
            profile.host,
            profile.port,
            observed.fingerprintSha256,
          );
          this.onStatus?.(profile.id, false);
          return 0;
        }
        return -2;
      }

      case "unknown": {
        // If the OS trust store already validated it and the profile uses
        // system trust, accept without prompting.
        if (request.errorCode === 0 && profile.certificateMode === "system") {
          return 0;
        }
        const decision = await this.promptOnce(profile, evaluation);
        if (decision === "trust-once") {
          this.certManager.trustOnce(profile.host, profile.port, observed.fingerprintSha256);
          return 0;
        }
        if (decision === "trust-and-pin") {
          await this.certManager.pin(
            profile.id,
            profile.host,
            profile.port,
            observed.fingerprintSha256,
          );
          return 0;
        }
        return -2;
      }

      default:
        return -2;
    }
  }

  private promptOnce(
    profile: ServerProfile,
    evaluation: Extract<CertificateEvaluation, { status: "unknown" } | { status: "mismatch" }>,
  ): Promise<CertificateDecision> {
    const key = this.hostKey(profile);
    const pending = this.inFlightPrompts.get(key);
    if (pending) return pending;

    const p = this.prompt({ profile, evaluation }).finally(() => {
      this.inFlightPrompts.delete(key);
    });
    this.inFlightPrompts.set(key, p);
    return p;
  }

  /** Clear cookies/cache for a single server (spec §38). */
  async clearSession(profileId: string): Promise<void> {
    const ses = this.sessions.get(profileId);
    if (!ses) return;
    await ses.clearStorageData();
    await ses.clearCache();
    logger.info({ module: "session", event: "session-cleared", serverProfileId: profileId });
  }
}
