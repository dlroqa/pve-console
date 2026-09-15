/**
 * HTTP(S) reachability check (spec §15 step 6, §4.5) and a small request
 * helper used by the Proxmox detection step.
 *
 * The request agent uses rejectUnauthorized:false for reachability probing
 * only (self-signed servers are expected). This is scoped to the diagnostics
 * request and is not a global TLS bypass.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { socketHost } from "../shared/validation";
import { ErrorCode } from "../shared/types";
import type { DiagnosticResult } from "./diagnostics-types";

export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  latencyMs: number;
}

export function httpGet(
  protocol: "https" | "http",
  host: string,
  port: number,
  path: string,
  timeoutMs = 8000,
  maxBodyBytes = 64 * 1024,
): Promise<HttpResponse> {
  const start = performance.now();
  const requester = protocol === "https" ? httpsRequest : httpRequest;

  return new Promise<HttpResponse>((resolve, reject) => {
    const req = requester(
      {
        host: socketHost(host),
        port,
        path,
        method: "GET",
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: { Accept: "application/json, text/html" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (c: Buffer) => {
          received += c.length;
          if (received <= maxBodyBytes) chunks.push(c);
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            latencyMs: Math.round((performance.now() - start) * 10) / 10,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

export async function httpCheck(
  protocol: "https" | "http",
  host: string,
  port: number,
): Promise<DiagnosticResult> {
  try {
    const res = await httpGet(protocol, host, port, "/");
    const ok = res.statusCode > 0 && res.statusCode < 500;
    return {
      id: "https",
      label: protocol === "https" ? "HTTPS" : "HTTP",
      status: ok ? "pass" : "warn",
      message: `Server responded with HTTP ${res.statusCode}.`,
      latencyMs: res.latencyMs,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      id: "https",
      label: protocol === "https" ? "HTTPS" : "HTTP",
      status: "fail",
      message: `No HTTP(S) response (${e.code ?? e.message}).`,
      errorCode: ErrorCode.HTTP_ERROR,
      possibleCauses: [
        "the service on this port is not an HTTP server",
        "wrong protocol (http vs https)",
        "server still starting up",
      ],
    };
  }
}
