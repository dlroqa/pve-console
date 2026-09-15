import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { runDiagnostics } from "../../src/diagnostics/diagnostics-engine";
import { ErrorCode } from "../../src/shared/types";

/** Reserve then release a port so it is guaranteed closed. */
async function guaranteedClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("no port"));
      }
    });
    srv.on("error", reject);
  });
}

describe("diagnostics orchestration (spec §15, Phase 4 acceptance)", () => {
  it("fails host validation and skips downstream tests", async () => {
    const report = await runDiagnostics({ protocol: "https", host: "bad host!!", port: 8006 });
    const host = report.results.find((r) => r.id === "host");
    expect(host?.status).toBe("fail");
    // No TCP/TLS attempted after a host validation failure.
    expect(report.results.find((r) => r.id === "tcp")).toBeUndefined();
    expect(report.proxmoxDetected).toBe(false);
  });

  it("identifies a TCP failure separately and skips TLS/HTTP", async () => {
    const port = await guaranteedClosedPort();
    const report = await runDiagnostics({ protocol: "https", host: "127.0.0.1", port });

    const tcp = report.results.find((r) => r.id === "tcp");
    expect(tcp?.status).toBe("fail");
    expect(tcp?.errorCode).toBe(ErrorCode.TCP_ERROR);
    expect(tcp?.possibleCauses?.length).toBeGreaterThan(0);

    // TLS and HTTP are reported as skipped (separate from the TCP failure).
    expect(report.results.find((r) => r.id === "tls")?.status).toBe("skipped");
    expect(report.results.find((r) => r.id === "https")?.status).toBe("skipped");
    expect(report.results.find((r) => r.id === "proxmox")?.status).toBe("skipped");
  }, 15000);

  it("builds the expected base URL in the report", async () => {
    const report = await runDiagnostics({ protocol: "https", host: "10.0.0.1", port: 8006 });
    expect(report.baseUrl).toBe("https://10.0.0.1:8006");
  }, 15000);
});
