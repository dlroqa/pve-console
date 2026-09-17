import { useEffect, useState } from "react";
import type { AiStatus, AiAnalysisKind, AiAnalysisResult } from "../../ai/ai-types";
import { unwrap, errorMessage } from "../ipc";

interface Props {
  profileId: string;
  onOpenSettings: () => void;
}

const KIND_LABELS: Record<Exclude<AiAnalysisKind, "explain-error">, string> = {
  "node-health": "Summarize node health",
  "resource-pressure": "Identify resource pressure",
  optimize: "Suggest safe optimizations",
};

/**
 * Optional AI assistant panel (spec §12). Advisory only — it never performs
 * actions. Any recommendation is carried out by the user through the confirmed
 * VM/LXC controls.
 */
export function AiAssistant({ profileId, onOpenSettings }: Props): JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [result, setResult] = useState<AiAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    unwrap(window.pve.ai.getStatus())
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const run = async (kind: AiAnalysisKind, input?: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await unwrap(window.pve.ai.analyze(profileId, kind, input));
      setResult(r);
      window.dispatchEvent(new Event("pve:ai-usage"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.configured) {
    return (
      <div className="card" style={{ maxWidth: 680, marginTop: 12 }}>
        <div style={{ color: "var(--text-dim)" }}>
          The optional AI assistant is not configured. Sign in through the official CLI from Settings to enable
          health summaries and troubleshooting help.
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={onOpenSettings}>Open Settings</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 680, marginTop: 12 }}>
      <div className="banner info" style={{ marginTop: 0 }}>
        Advisory only. The assistant analyzes read-only cluster data and suggests actions — it never
        performs them. Requests use the official {status?.provider === "openai" ? "Codex" : "Claude Code"} CLI ({status?.model}).
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(KIND_LABELS) as Array<keyof typeof KIND_LABELS>).map((k) => (
          <button key={k} disabled={busy} onClick={() => run(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 14 }}>
        <label>Explain a Proxmox error or log</label>
        <textarea
          value={errorText}
          onChange={(e) => setErrorText(e.target.value)}
          rows={4}
          placeholder="Paste an error message or log excerpt…"
          style={{
            width: "100%",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 12.5,
            padding: 10,
            background: "var(--bg)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 7,
            resize: "vertical",
          }}
        />
        <div style={{ marginTop: 8 }}>
          <button
            disabled={busy || errorText.trim().length === 0}
            onClick={() => run("explain-error", errorText)}
          >
            {busy ? "Thinking…" : "Explain"}
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div className="ai-output">{result.text}</div>
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 8 }}>
            Recommendation only — apply changes yourself via the confirmed controls. ({result.model})
          </div>
        </div>
      )}
    </div>
  );
}
