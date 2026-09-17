import { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/types";
import type { ServerProfile } from "../../profiles/profile-types";
import type { CertificatePin } from "../../certificates/certificate-types";
import type { ApiTokenStatus } from "../../proxmox/proxmox-types";
import type { AiStatus, AiProvider } from "../../ai/ai-types";
import { unwrap, errorMessage } from "../ipc";

interface Props {
  settings: AppSettings;
  profiles: ServerProfile[];
  onSettingsChange: (settings: AppSettings) => void;
}

export function Settings({ settings, profiles, onSettingsChange }: Props): JSX.Element {
  const [pins, setPins] = useState<CertificatePin[]>([]);
  const [tokenStatuses, setTokenStatuses] = useState<Record<string, ApiTokenStatus>>({});
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>("anthropic");
  const [aiModel, setAiModel] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    unwrap(window.pve.certificate.list())
      .then(setPins)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const loadTokenStatuses = async () => {
    const entries = await Promise.all(
      profiles.map(async (p) => [p.id, await unwrap(window.pve.proxmox.getTokenStatus(p.id))] as const),
    );
    setTokenStatuses(Object.fromEntries(entries));
  };

  useEffect(() => {
    loadTokenStatuses().catch((e) => setError(errorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const removeToken = async (id: string, name: string) => {
    try {
      await unwrap(window.pve.proxmox.removeToken(id));
      setNotice(`API token removed for “${name}”. Browser mode is unaffected.`);
      await loadTokenStatuses();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const applyAiStatus = (s: AiStatus) => {
    setAiStatus(s);
    setAiProvider(s.provider);
    setAiModel(s.model === "Account default" ? "" : s.model);
  };

  useEffect(() => {
    unwrap(window.pve.ai.getStatus())
      .then(applyAiStatus)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const changeProvider = async (provider: AiProvider) => {
    setAiProvider(provider);
    try {
      // Switch active provider; its optional model preference comes back.
      applyAiStatus(await unwrap(window.pve.ai.setConfig({ provider })));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const saveAiConfig = async () => {
    try {
      const s = await unwrap(
        window.pve.ai.setConfig({
          provider: aiProvider,
          model: aiModel,
        }),
      );
      applyAiStatus(s);
      setNotice("AI settings saved.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const save = async (next: AppSettings) => {
    try {
      const saved = await unwrap(window.pve.settings.set(next));
      onSettingsChange(saved);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const chooseDir = async () => {
    const dir = await unwrap(window.pve.system.chooseDownloadDirectory());
    if (dir) await save({ ...settings, defaultDownloadDirectory: dir });
  };

  const clearSession = async (id: string, name: string) => {
    try {
      await unwrap(window.pve.server.clearSession(id));
      setNotice(`Session cleared for “${name}”. You will need to sign in again.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="subtitle">Appearance, behavior, certificates and sessions.</p>

      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner info">{notice}</div>}

      <div className="form-grid">
        <div className="field">
          <label>Appearance</label>
          <select
            value={settings.theme}
            onChange={(e) => save({ ...settings, theme: e.target.value as AppSettings["theme"] })}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.openExternalLinksInSystemBrowser}
              onChange={(e) =>
                save({ ...settings, openExternalLinksInSystemBrowser: e.target.checked })
              }
            />
            Open external links in the system browser
          </label>
        </div>

        <div className="field">
          <label>Download directory</label>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={settings.defaultDownloadDirectory ?? ""} readOnly placeholder="System default" />
            <button onClick={chooseDir}>Choose…</button>
          </div>
        </div>

        <div className="field">
          <label>Logging level</label>
          <select
            value={settings.logLevel}
            onChange={(e) => save({ ...settings, logLevel: e.target.value as AppSettings["logLevel"] })}
          >
            <option value="error">error</option>
            <option value="warn">warn</option>
            <option value="info">info</option>
            <option value="debug">debug</option>
          </select>
        </div>

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.enableDeveloperDiagnostics}
              onChange={(e) => save({ ...settings, enableDeveloperDiagnostics: e.target.checked })}
            />
            Enable developer diagnostics
          </label>
        </div>

        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.rememberServerSessions}
              onChange={(e) => save({ ...settings, rememberServerSessions: e.target.checked })}
            />
            Remember server sessions between launches
          </label>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 30 }}>Certificate management</h2>
      {pins.length === 0 ? (
        <div className="empty" style={{ textAlign: "left", padding: "10px 0" }}>
          No pinned certificates.
        </div>
      ) : (
        <div className="diag-list">
          {pins.map((pin) => (
            <div className="diag-row" key={`${pin.host}:${pin.port}`}>
              <span className="label">
                {pin.host}:{pin.port}
              </span>
              <div className="msg certificate-pin">
                <span className="certificate-fingerprint">{pin.fingerprintSha256}</span>
                <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
                  pinned {new Date(pin.approvedAt).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, marginTop: 30 }}>Server sessions</h2>
      {profiles.length === 0 ? (
        <div className="empty" style={{ textAlign: "left", padding: "10px 0" }}>
          No servers configured.
        </div>
      ) : (
        <div className="card-grid">
          {profiles.map((p) => (
            <div className="card" key={p.id}>
              <div className="name" style={{ fontWeight: 600 }}>
                {p.name}
              </div>
              <div className="addr">
                {p.host}:{p.port}
              </div>
              <div style={{ marginTop: 12 }}>
                <button onClick={() => clearSession(p.id, p.name)}>Reset Session</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, marginTop: 30 }}>Native API tokens</h2>
      {profiles.length === 0 ? (
        <div className="empty" style={{ textAlign: "left", padding: "10px 0" }}>
          No servers configured.
        </div>
      ) : (
        <div className="diag-list">
          {profiles.map((p) => {
            const status = tokenStatuses[p.id];
            return (
              <div className="diag-row" key={p.id}>
                <span className="label">{p.name}</span>
                <span className="msg">
                  {status?.configured
                    ? `token ${status.tokenName}`
                    : "no token — browser mode only"}
                </span>
                {status?.configured && (
                  <button className="ghost" onClick={() => removeToken(p.id, p.name)}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 style={{ fontSize: 16, marginTop: 30 }}>AI Assistant (subscription)</h2>
      <div className="banner info">
        Uses your official Claude Code or Codex CLI login. PVE Console sends only the authorized
        read-only cluster summary or log text. The local five-hour counter covers this app only.
      </div>
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="inline-row">
          <div className="field">
            <label>Provider</label>
            <select value={aiProvider} onChange={(e) => changeProvider(e.target.value as AiProvider)}>
              <option value="anthropic">Claude subscription</option>
              <option value="openai">ChatGPT subscription (Codex)</option>
            </select>
          </div>
          <div className="field">
            <label>Model override (optional)</label>
            <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="Account default" />
          </div>
        </div>
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button className="primary" onClick={saveAiConfig}>Save settings</button>
          <button onClick={() => { void unwrap(window.pve.ai.getStatus()).then(applyAiStatus); }}>Refresh status</button>
        </div>
        <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 10 }}>
          {aiStatus?.cliInstalled
            ? aiStatus.configured
              ? `Ready — ${aiStatus.authMessage}`
              : `Sign in first from a terminal with ${aiProvider === "openai" ? "codex login" : "claude auth login"}.`
            : `Install the official ${aiProvider === "openai" ? "Codex" : "Claude Code"} CLI first.`}
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginTop: 30 }}>Application updates</h2>
      <div className="banner info">
        Auto-update is prepared in the packaging pipeline and does not bypass package signing. It is
        not enabled in this version.
      </div>
    </div>
  );
}
