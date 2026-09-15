import { useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import { unwrap, errorMessage } from "../ipc";

interface Props {
  profile: ServerProfile;
  onConfigured: () => void | Promise<void>;
}

/**
 * Configure a restricted Proxmox API token (spec §9.2, §19).
 * The secret is sent to the main process and stored encrypted; it is never
 * echoed back or persisted in plaintext.
 */
export function TokenConfig({ profile, onConfigured }: Props): JSX.Element {
  const [tokenName, setTokenName] = useState("");
  const [tokenSecret, setTokenSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await unwrap(window.pve.proxmox.setToken(profile.id, tokenName.trim(), tokenSecret));
      setTokenSecret("");
      await onConfigured();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Save first (so the stored secret is what we verify), then verify.
      await unwrap(window.pve.proxmox.setToken(profile.id, tokenName.trim(), tokenSecret));
      const res = await unwrap(window.pve.proxmox.verifyToken(profile.id));
      setNotice(`Token verified. Proxmox API version ${res.version}.`);
      setTokenSecret("");
      await onConfigured();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      {error && <div className="banner error">{error}</div>}
      {notice && <div className="banner info">{notice}</div>}

      <div className="field">
        <label>API Token ID</label>
        <input
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="user@realm!tokenid  (e.g. dashboard@pve!console)"
        />
        <div className="hint">Use a dedicated, least-privilege token — never root credentials.</div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Token Secret</label>
        <input
          type="password"
          value={tokenSecret}
          onChange={(e) => setTokenSecret(e.target.value)}
          placeholder="Stored encrypted via the OS credential store"
          autoComplete="off"
        />
      </div>

      <div className="form-actions" style={{ marginTop: 14 }}>
        <button onClick={test} disabled={busy || !tokenName || !tokenSecret}>
          {busy ? "Working…" : "Test Token"}
        </button>
        <button className="primary" onClick={save} disabled={busy || !tokenName || !tokenSecret}>
          Save Token
        </button>
      </div>
    </div>
  );
}
