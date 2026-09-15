/**
 * TLS handshake + certificate inspection (spec §15 steps 4-5, §4.4).
 *
 * Connects with certificate validation disabled ONLY for this inspection
 * socket so that a self-signed certificate can still be inspected (spec §4
 * acceptance). This is a per-connection inspection, not a global TLS bypass:
 * the embedded browser and API client validate/pin independently.
 */

import { connect as tlsConnect, type PeerCertificate } from "node:tls";
import { socketHost } from "../shared/validation";
import { fingerprintFromDer } from "../certificates/fingerprint";
import { ErrorCode } from "../shared/types";
import type { DiagnosticResult } from "./diagnostics-types";
import type { CertificateInfo } from "../certificates/certificate-types";

export interface TlsInspectionResult {
  tls: DiagnosticResult;
  certificate: DiagnosticResult;
  certificateInfo?: CertificateInfo;
}

function toCertificateInfo(
  cert: PeerCertificate,
  host: string,
  port: number,
): CertificateInfo | undefined {
  if (!cert || Object.keys(cert).length === 0) return undefined;
  const raw = (cert as PeerCertificate & { raw?: Buffer }).raw;
  const fingerprint = raw ? fingerprintFromDer(raw) : "";
  const fmt = (v: Record<string, string | string[]> | undefined) =>
    v
      ? Object.entries(v)
          .map(([k, val]) => `${k}=${Array.isArray(val) ? val.join(",") : val}`)
          .join(", ")
      : "";
  return {
    subject: fmt(cert.subject as unknown as Record<string, string>),
    issuer: fmt(cert.issuer as unknown as Record<string, string>),
    validFrom: cert.valid_from,
    validTo: cert.valid_to,
    fingerprintSha256: fingerprint,
    host,
    port,
  };
}

export async function tlsCheck(
  host: string,
  port: number,
  timeoutMs = 8000,
): Promise<TlsInspectionResult> {
  const start = performance.now();
  return new Promise<TlsInspectionResult>((resolve) => {
    let settled = false;
    const socket = tlsConnect({
      host: socketHost(host),
      port,
      servername: socketHost(host),
      // Inspection socket only — allows inspecting self-signed certs. The
      // authorization result is reported separately below.
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    const finish = (result: TlsInspectionResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.on("secureConnect", () => {
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      const peer = socket.getPeerCertificate(true);
      const info = toCertificateInfo(peer, host, port);
      const authorized = socket.authorized;
      const authError = socket.authorizationError as unknown as string | undefined;

      const tls: DiagnosticResult = {
        id: "tls",
        label: "TLS",
        status: "pass",
        message: authorized
          ? "TLS handshake succeeded; certificate chain validated by system trust."
          : "TLS handshake succeeded; certificate is not validated by system trust (self-signed expected).",
        latencyMs,
      };

      const certificate: DiagnosticResult = info
        ? {
            id: "certificate",
            label: "Certificate",
            status: "pass",
            message: authorized
              ? "Certificate inspected and system-trusted."
              : `Certificate inspected (self-signed / untrusted: ${authError ?? "unverified"}).`,
            certificate: info,
          }
        : {
            id: "certificate",
            label: "Certificate",
            status: "warn",
            message: "TLS connected but no peer certificate was presented.",
          };

      finish({ tls, certificate, certificateInfo: info });
    });

    socket.on("timeout", () => {
      finish({
        tls: {
          id: "tls",
          label: "TLS",
          status: "fail",
          message: "TLS handshake timed out.",
          errorCode: ErrorCode.TLS_ERROR,
          possibleCauses: ["server not speaking TLS on this port", "network latency", "firewall interference"],
        },
        certificate: {
          id: "certificate",
          label: "Certificate",
          status: "skipped",
          message: "Skipped — TLS handshake did not complete.",
        },
      });
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      finish({
        tls: {
          id: "tls",
          label: "TLS",
          status: "fail",
          message: `TLS handshake failed (${err.code ?? err.message}).`,
          errorCode: ErrorCode.TLS_ERROR,
          possibleCauses: [
            "the port is not serving HTTPS/TLS",
            "protocol set to http but server requires https",
            "TLS version/cipher mismatch",
          ],
        },
        certificate: {
          id: "certificate",
          label: "Certificate",
          status: "skipped",
          message: "Skipped — TLS handshake failed.",
        },
      });
    });
  });
}
