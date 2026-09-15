import { useEffect, useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { DiagnosticsReport } from "../../diagnostics/diagnostics-types";
import { DiagnosticsPanel } from "../components/DiagnosticsPanel";
import { unwrap, errorMessage } from "../ipc";

interface Props {
  profiles: ServerProfile[];
  initialServerId?: string;
}

export function Diagnostics({ profiles, initialServerId }: Props): JSX.Element {
  const [selectedId, setSelectedId] = useState<string>(
    initialServerId ?? profiles[0]?.id ?? "",
  );
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const run = async (profile: ServerProfile) => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const r = await unwrap(
        window.pve.diagnostics.run({
          serverProfileId: profile.id,
          protocol: profile.protocol,
          host: profile.host,
          port: profile.port,
        }),
      );
      setReport(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    setReport(null);
  }, [selectedId]);

  return (
    <div className="page">
      <h1>Connection Diagnostics</h1>
      <p className="subtitle">Run per-server connectivity tests against the selected Proxmox server.</p>

      {profiles.length === 0 ? (
        <div className="empty">Add a server first to run diagnostics.</div>
      ) : (
        <>
          <div className="inline-row" style={{ maxWidth: 520, marginBottom: 16 }}>
            <div className="field" style={{ flex: 2 }}>
              <label>Server</label>
              <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.host}:{p.port})
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                className="primary"
                disabled={!selected || running}
                onClick={() => selected && run(selected)}
              >
                {running ? "Running…" : "Run Diagnostics"}
              </button>
            </div>
          </div>

          {error && <div className="banner error">{error}</div>}
          {report && <DiagnosticsPanel report={report} />}
        </>
      )}
    </div>
  );
}
