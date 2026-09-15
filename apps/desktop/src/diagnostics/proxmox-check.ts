/**
 * Proxmox detection (spec §15 step 7, §4.6).
 *
 * Uses several independent signals rather than one fragile HTML string:
 *  1. The /api2/json/version endpoint behaves like the Proxmox REST API
 *     (JSON body, or a 401 challenge, from the pve-api-daemon).
 *  2. The Server response header identifies pve-api-daemon.
 *  3. The root page references the Proxmox web UI (pve manager / widget kit).
 *
 * Detection requires more than one weak signal, or one strong signal.
 */

import { httpGet } from "./http-check";
import { ErrorCode } from "../shared/types";
import type { DiagnosticResult } from "./diagnostics-types";

interface Signal {
  name: string;
  strong: boolean;
  matched: boolean;
}

export async function proxmoxCheck(
  protocol: "https" | "http",
  host: string,
  port: number,
): Promise<DiagnosticResult> {
  const signals: Signal[] = [];

  // Signal 1 + 2: the REST API endpoint and its server header.
  try {
    const api = await httpGet(protocol, host, port, "/api2/json/version");
    const server = String(api.headers["server"] ?? "").toLowerCase();
    const looksLikeApiDaemon = server.includes("pve-api-daemon") || server.includes("pve");
    // The version endpoint returns JSON, and without auth typically 401.
    const jsonish =
      api.body.trim().startsWith("{") &&
      (api.body.includes("\"data\"") || api.statusCode === 401);
    const authChallenge = api.statusCode === 401 && looksLikeApiDaemon;

    signals.push({ name: "api-server-header", strong: true, matched: looksLikeApiDaemon });
    signals.push({ name: "api2-version-json", strong: authChallenge, matched: jsonish || authChallenge });
  } catch {
    signals.push({ name: "api-server-header", strong: true, matched: false });
    signals.push({ name: "api2-version-json", strong: false, matched: false });
  }

  // Signal 3: the root page references the Proxmox web UI.
  try {
    const root = await httpGet(protocol, host, port, "/");
    const body = root.body.toLowerCase();
    const htmlSignal =
      body.includes("proxmox") ||
      body.includes("pvemanager") ||
      body.includes("pve manager") ||
      body.includes("/pve2/") ||
      body.includes("proxmoxlib");
    signals.push({ name: "web-ui-markers", strong: false, matched: htmlSignal });
  } catch {
    signals.push({ name: "web-ui-markers", strong: false, matched: false });
  }

  const matched = signals.filter((s) => s.matched);
  const strongMatched = matched.some((s) => s.strong);
  const detected = strongMatched || matched.length >= 2;

  if (detected) {
    return {
      id: "proxmox",
      label: "Proxmox",
      status: "pass",
      message: "Proxmox server detected.",
    };
  }

  return {
    id: "proxmox",
    label: "Proxmox",
    status: matched.length === 1 ? "warn" : "fail",
    message:
      matched.length === 1
        ? "Endpoint is reachable but only weakly resembles Proxmox."
        : "Endpoint did not behave like a Proxmox server.",
    errorCode: ErrorCode.PROXMOX_NOT_DETECTED,
    possibleCauses: [
      "the address/port points to a different service",
      "a reverse proxy is stripping Proxmox responses",
      "Proxmox is running on a different port",
    ],
  };
}
