import type { DiagnosticsReport, DiagnosticStatus } from "../../diagnostics/diagnostics-types";

const ICON: Record<DiagnosticStatus, string> = {
  pass: "✓",
  fail: "✗",
  warn: "!",
  skipped: "–",
};

export function DiagnosticsPanel({ report }: { report: DiagnosticsReport }): JSX.Element {
  return (
    <div>
      <div className="banner info">
        Target <strong>{report.baseUrl}</strong>
        {" — "}
        {report.proxmoxDetected ? "Proxmox server detected." : "Proxmox not confirmed."}
      </div>
      <div className="diag-list">
        {report.results.map((r) => (
          <div className="diag-row" key={r.id}>
            <span className={`icon ${r.status}`}>{ICON[r.status]}</span>
            <span className="label">{r.label}</span>
            <span className="msg">
              {r.message}
              {r.possibleCauses && r.possibleCauses.length > 0 && (
                <ul className="causes">
                  {r.possibleCauses.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
