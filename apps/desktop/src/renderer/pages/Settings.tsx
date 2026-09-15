import { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/types";
import type { ServerProfile } from "../../profiles/profile-types";
import type { CertificatePin } from "../../certificates/certificate-types";
import type { ApiTokenStatus } from "../../proxmox/proxmox-types";
import type { AiStatus } from "../../ai/ai-types";
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
  const [aiKey, setAiKey] = useState("");
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

  useEffect(() => {
    unwrap(window.pve.ai.getStatus())
      .then(setAiStatus)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const saveAiKey = async () => {
    try {
      await unwrap(window.pve.ai.setApiKey(aiKey.trim()));
      setAiKey("");
      setNotice("AI assistant enabled. Its analysis is advisory only.");
      setAiStatus(await unwrap(window.pve.ai.getStatus()));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const removeAiKey = async () => {
    try {
      await unwrap(window.pve.ai.removeApiKey());
      setNotice("AI assistant disabled.");
      setAiStatus(await unwrap(window.pve.ai.getStatus()));
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
              <span className="msg">
                {pin.fingerprintSha256}
                <div style={{ color: "var(--text-faint)", fontSize: 12 }}>
                  pinned {new Date(pin.approvedAt).toLocaleString()}
                </div>
              </span>
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

      <h2 style={{ fontSize: 16, marginTop: 30 }}>AI Assistant (optional)</h2>
      <div className="banner info">
        Advisory only. When enabled, the assistant sends read-only cluster summaries to Anthropic
        for analysis and never performs actions. The API key is stored encrypted.
      </div>
      {aiStatus?.configured ? (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="kv-table">
            <span className="k">Status</span>
            <span className="v">Enabled</span>
            <span className="k">Model</span>
            <span className="v">{aiStatus.model}</span>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="danger" onClick={removeAiKey}>
              Disable &amp; remove key
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="field">
            <label>Anthropic API key</label>
            <input
              type="password"
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              placeholder="sk-ant-…  (stored encrypted via the OS credential store)"
              autoComplete="off"
            />
          </div>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button className="primary" onClick={saveAiKey} disabled={aiKey.trim().length < 8}>
              Enable Assistant
            </button>
          </div>
        </div>
      )}

      <h2 style={{ fontSize: 16, marginTop: 30 }}>Application updates</h2>
      <div className="banner info">
        Auto-update is prepared in the packaging pipeline and does not bypass package signing. It is
        not enabled in this version.
      </div>
    </div>
  );
}
