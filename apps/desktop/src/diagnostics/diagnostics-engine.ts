/**
 * Diagnostics engine (spec §15, §4).
 *
 * Runs the required tests in logical order and returns individual results:
 *   1. Host validation
 *   2. DNS resolution (only when the host is a name)
 *   3. TCP connection
 *   4. TLS handshake
 *   5. Certificate inspection
 *   6. HTTP(S) reachability
 *   7. Proxmox detection
 *   8. WebSocket capability (where practical)
 *   9. Response latency
 *
 * Later network steps are skipped when an earlier prerequisite fails, so a
 * TLS problem is reported separately from an HTTP failure.
 */

import { lookup } from "node:dns/promises";
import { connect as tlsConnect } from "node:tls";
import { isValidHost, isDnsHost, buildBaseUrl, socketHost } from "../shared/validation";
import { ErrorCode } from "../shared/types";
import { tcpCheck } from "./tcp-check";
import { tlsCheck } from "./tls-check";
import { httpCheck } from "./http-check";
import { proxmoxCheck } from "./proxmox-check";
import type {
  DiagnosticResult,
  DiagnosticsReport,
  DiagnosticsTarget,
} from "./diagnostics-types";

function hostResult(host: string): DiagnosticResult {
  if (isValidHost(host)) {
    return { id: "host", label: "Host", status: "pass", message: `Address "${host}" is valid.` };
  }
  return {
    id: "host",
    label: "Host",
    status: "fail",
    message: `"${host}" is not a valid IP address or hostname.`,
    errorCode: ErrorCode.NETWORK_ERROR,
    possibleCauses: ["typo in the address", "unsupported address format"],
  };
}

async function dnsResult(host: string): Promise<DiagnosticResult> {
  if (!isDnsHost(host)) {
    return { id: "dns", label: "DNS", status: "skipped", message: "Not required for an IP address." };
  }
  try {
    const { address } = await lookup(host);
    return { id: "dns", label: "DNS", status: "pass", message: `Resolved to ${address}.` };
  } catch {
    return {
      id: "dns",
      label: "DNS",
      status: "fail",
      message: `Could not resolve "${host}".`,
      errorCode: ErrorCode.DNS_ERROR,
      possibleCauses: [
        "hostname is misspelled",
        "DNS server unavailable",
        "private DNS/VPN route not active",
      ],
    };
  }
}

/** Practical WebSocket capability probe via an Upgrade handshake. */
async function websocketResult(
  protocol: "https" | "http",
  host: string,
  port: number,
  timeoutMs = 6000,
): Promise<DiagnosticResult> {
  if (protocol !== "https") {
    return { id: "websocket", label: "WebSocket", status: "skipped", message: "Skipped for non-TLS target." };
  }
  return new Promise<DiagnosticResult>((resolve) => {
    let settled = false;
    const socket = tlsConnect({
      host: socketHost(host),
      port,
      servername: socketHost(host),
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });
    const done = (r: DiagnosticResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    socket.on("secureConnect", () => {
      const key = Buffer.from("pveconsole-probe!").toString("base64");
      socket.write(
        `GET / HTTP/1.1\r\nHost: ${socketHost(host)}:${port}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.once("data", (buf: Buffer) => {
      const head = buf.toString("utf8").split("\r\n")[0] ?? "";
      if (head.includes(" 101 ")) {
        done({ id: "websocket", label: "WebSocket", status: "pass", message: "Server accepted a WebSocket upgrade." });
      } else {
        done({
          id: "websocket",
          label: "WebSocket",
          status: "warn",
          message: `HTTP stack is alive (${head.trim() || "response received"}); full WebSocket verified during console use.`,
        });
      }
    });
    socket.on("timeout", () =>
      done({ id: "websocket", label: "WebSocket", status: "warn", message: "No upgrade response before timeout." }),
    );
    socket.on("error", () =>
      done({
        id: "websocket",
        label: "WebSocket",
        status: "fail",
        message: "Could not establish a socket for WebSocket testing.",
        errorCode: ErrorCode.WEBSOCKET_ERROR,
      }),
    );
  });
}

export async function runDiagnostics(target: DiagnosticsTarget): Promise<DiagnosticsReport> {
  const startedAt = new Date().toISOString();
  const { protocol, host, port } = target;
  const baseUrl = buildBaseUrl(protocol, host, port);
  const results: DiagnosticResult[] = [];

  // 1. Host
  const host1 = hostResult(host);
  results.push(host1);
  if (host1.status === "fail") {
    return finalize(target, baseUrl, startedAt, results);
  }

  // 2. DNS
  const dns = await dnsResult(host);
  results.push(dns);

  // 3. TCP
  const tcp = await tcpCheck(host, port);
  results.push(tcp);

  if (tcp.status === "fail") {
    // Prerequisite for TLS/HTTP failed — mark downstream steps clearly.
    results.push(skip("tls", "TLS", "Skipped — TCP connection failed."));
    results.push(skip("certificate", "Certificate", "Skipped — TCP connection failed."));
    results.push(skip("https", protocol === "https" ? "HTTPS" : "HTTP", "Skipped — TCP connection failed."));
    results.push(skip("proxmox", "Proxmox", "Skipped — TCP connection failed."));
    results.push(skip("websocket", "WebSocket", "Skipped — TCP connection failed."));
    return finalize(target, baseUrl, startedAt, results);
  }

  // 4 + 5. TLS + certificate (only for https)
  if (protocol === "https") {
    const tls = await tlsCheck(host, port);
    results.push(tls.tls);
    results.push(tls.certificate);
  } else {
    results.push(skip("tls", "TLS", "Skipped — protocol is http."));
    results.push(skip("certificate", "Certificate", "Skipped — protocol is http."));
  }

  // 6. HTTP(S)
  const http = await httpCheck(protocol, host, port);
  results.push(http);

  // 7. Proxmox detection
  const proxmox =
    http.status === "fail"
      ? skip("proxmox", "Proxmox", "Skipped — HTTP(S) not reachable.")
      : await proxmoxCheck(protocol, host, port);
  results.push(proxmox);

  // 8. WebSocket
  results.push(await websocketResult(protocol, host, port));

  return finalize(target, baseUrl, startedAt, results);
}

function skip(id: DiagnosticResult["id"], label: string, message: string): DiagnosticResult {
  return { id, label, status: "skipped", message };
}

function finalize(
  target: DiagnosticsTarget,
  baseUrl: string,
  startedAt: string,
  results: DiagnosticResult[],
): DiagnosticsReport {
  // 9. Latency roll-up from the fastest meaningful measurement.
  const latencies = results
    .map((r) => r.latencyMs)
    .filter((v): v is number => typeof v === "number");
  const latencyMs = latencies.length ? Math.min(...latencies) : undefined;
  results.push({
    id: "latency",
    label: "Latency",
    status: latencyMs === undefined ? "skipped" : "pass",
    message: latencyMs === undefined ? "No latency measured." : `${latencyMs} ms`,
    latencyMs,
  });

  const proxmoxDetected = results.some((r) => r.id === "proxmox" && r.status === "pass");

  return {
    target,
    baseUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
    proxmoxDetected,
  };
}
