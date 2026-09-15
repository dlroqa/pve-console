/**
 * Native Proxmox REST API client (spec §9, §36).
 *
 * FOUNDATION ONLY — not used by Version 1 (spec §53). Native API calls must
 * originate from the trusted main process, never from remote page JavaScript
 * (spec §9.1, §36). Prefer a restricted API token, never root credentials
 * (spec §9.2, §19). Read-only endpoints are implemented first (spec §9.4).
 *
 * This client validates TLS against pinned/trusted certificates rather than
 * disabling verification globally (spec §0.2).
 */

import { request as httpsRequest } from "node:https";
import { buildBaseUrl, socketHost } from "../shared/validation";
import { fingerprintFromDer, fingerprintsEqual } from "../certificates/fingerprint";
import { ErrorCode } from "../shared/types";
import type { AppError, Protocol } from "../shared/types";

export interface ProxmoxClientConfig {
  protocol: Protocol;
  host: string;
  port: number;
  /** "user@realm!tokenid" */
  tokenName: string;
  tokenSecret: string;
  /** Optional pinned fingerprint to validate against. */
  pinnedFingerprint?: string;
}

export class ProxmoxApiError extends Error {
  constructor(
    public readonly appError: AppError,
    public readonly statusCode?: number,
  ) {
    super(appError.message);
    this.name = "ProxmoxApiError";
  }
}

export class ProxmoxClient {
  private readonly baseUrl: string;

  constructor(private readonly config: ProxmoxClientConfig) {
    this.baseUrl = buildBaseUrl(config.protocol, config.host, config.port);
  }

  /** GET a JSON API path (read-only). Returns the `data` payload. */
  async get<T>(path: string, timeoutMs = 10_000): Promise<T> {
    const url = `${this.baseUrl}/api2/json${path}`;
    return new Promise<T>((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: "GET",
          host: socketHost(this.config.host),
          port: this.config.port,
          timeout: timeoutMs,
          // We validate the pinned fingerprint ourselves below; do not rely on
          // a global bypass. When no pin is set, system trust applies.
          rejectUnauthorized: !this.config.pinnedFingerprint,
          headers: {
            Authorization: `PVEAPIToken=${this.config.tokenName}=${this.config.tokenSecret}`,
            Accept: "application/json",
          },
        },
        (res) => {
          // Enforce fingerprint pinning at the socket level.
          const socket = res.socket as unknown as {
            getPeerCertificate?: (d?: boolean) => { raw?: Buffer };
          };
          if (this.config.pinnedFingerprint && socket.getPeerCertificate) {
            const peer = socket.getPeerCertificate(true);
            const fp = peer?.raw ? fingerprintFromDer(peer.raw) : "";
            if (!fingerprintsEqual(fp, this.config.pinnedFingerprint)) {
              res.destroy();
              reject(
                new ProxmoxApiError({
                  code: ErrorCode.CERTIFICATE_MISMATCH,
                  message: "The server certificate does not match the pinned fingerprint.",
                }),
              );
              return;
            }
          }

          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const status = res.statusCode ?? 0;
            const bodyText = Buffer.concat(chunks).toString("utf8");
            if (status === 401 || status === 403) {
              reject(
                new ProxmoxApiError(
                  {
                    code: status === 401 ? ErrorCode.AUTH_ERROR : ErrorCode.API_PERMISSION_ERROR,
                    message:
                      status === 401
                        ? "Authentication failed for the Proxmox API token."
                        : "The API token lacks permission for this operation.",
                  },
                  status,
                ),
              );
              return;
            }
            try {
              const parsed = JSON.parse(bodyText) as { data: T };
              resolve(parsed.data);
            } catch {
              reject(
                new ProxmoxApiError({
                  code: ErrorCode.HTTP_ERROR,
                  message: "Unexpected non-JSON response from the Proxmox API.",
                }),
              );
            }
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (err) =>
        reject(
          new ProxmoxApiError({
            code: ErrorCode.NETWORK_ERROR,
            message: `Proxmox API request failed: ${(err as Error).message}`,
          }),
        ),
      );
      req.end();
    });
  }
}
