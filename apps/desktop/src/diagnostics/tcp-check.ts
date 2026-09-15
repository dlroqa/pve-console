/**
 * TCP reachability check (spec §15 step 3, §4.3).
 */

import { createConnection } from "node:net";
import { socketHost } from "../shared/validation";
import { ErrorCode } from "../shared/types";
import type { DiagnosticResult } from "./diagnostics-types";

export async function tcpCheck(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<DiagnosticResult> {
  const start = performance.now();
  return new Promise<DiagnosticResult>((resolve) => {
    const socket = createConnection({ host: socketHost(host), port });
    let settled = false;

    const finish = (result: DiagnosticResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      finish({
        id: "tcp",
        label: `TCP :${port}`,
        status: "pass",
        message: `Connected to port ${port}.`,
        latencyMs,
      });
    });

    socket.on("timeout", () => {
      finish({
        id: "tcp",
        label: `TCP :${port}`,
        status: "fail",
        message: `Timed out connecting to port ${port}.`,
        errorCode: ErrorCode.TCP_ERROR,
        possibleCauses: [
          "incorrect address",
          "Proxmox node offline",
          "pveproxy unavailable",
          "firewall block",
          "VPN route unavailable",
          "port changed",
        ],
      });
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      finish({
        id: "tcp",
        label: `TCP :${port}`,
        status: "fail",
        message: `Could not connect to port ${port} (${err.code ?? "error"}).`,
        errorCode: ErrorCode.TCP_ERROR,
        possibleCauses: [
          "incorrect address",
          "Proxmox node offline",
          "pveproxy unavailable",
          "firewall block",
          "VPN route unavailable",
          "port changed",
        ],
      });
    });
  });
}
