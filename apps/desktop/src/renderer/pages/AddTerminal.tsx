import { useState, type ChangeEvent, type FormEvent } from "react";
import type { CreateSshProfileInput, SshAuthType } from "../../ssh/ssh-types";
import { errorMessage, unwrap } from "../ipc";

interface Props {
  onSaved: (id: string) => void;
  onCancel: () => void;
}

export function AddTerminal({ onSaved, onCancel }: Props): JSX.Element {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<SshAuthType>("password");
  const [credential, setCredential] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [rememberCredential, setRememberCredential] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readPrivateKey = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setCredential(await file.text());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: CreateSshProfileInput = {
      name,
      host,
      port: Number(port),
      username,
      authType,
      credential,
      passphrase: passphrase || undefined,
      rememberCredential,
    };
    try {
      const profile = await unwrap(window.pve.terminalProfiles.create(input));
      onSaved(profile.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Add SSH Terminal</h1>
      <p className="subtitle">Create a direct remote terminal connection to a VM or host.</p>
      {error && <div className="banner error">{error}</div>}
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="terminal-name">Name</label>
          <input
            id="terminal-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Web VM"
            autoFocus
            required
          />
        </div>
        <div className="inline-row">
          <div className="field">
            <label htmlFor="terminal-host">Host or IP address</label>
            <input
              id="terminal-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="192.168.1.50"
              required
            />
          </div>
          <div className="field" style={{ maxWidth: 120 }}>
            <label htmlFor="terminal-port">SSH port</label>
            <input
              id="terminal-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="terminal-user">Username</label>
          <input
            id="terminal-user"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="root"
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="terminal-auth">Authentication</label>
          <select
            id="terminal-auth"
            value={authType}
            onChange={(event) => {
              setAuthType(event.target.value as SshAuthType);
              setCredential("");
            }}
          >
            <option value="password">Password</option>
            <option value="private-key">Private key</option>
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={rememberCredential}
            onChange={(event) => setRememberCredential(event.target.checked)}
          />
          Save credential using OS encryption
        </label>
        {!rememberCredential && (
          <div className="banner info" style={{ marginBottom: 0 }}>
            You will be asked for the credential each time you connect.
          </div>
        )}
        {rememberCredential && authType === "password" ? (
          <div className="field">
            <label htmlFor="terminal-password">Password</label>
            <input
              id="terminal-password"
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              autoComplete="new-password"
              required={rememberCredential}
            />
          </div>
        ) : rememberCredential ? (
          <>
            <div className="field">
              <label htmlFor="terminal-key-file">Private key file</label>
              <input id="terminal-key-file" type="file" onChange={readPrivateKey} />
              <div className="hint">The key contents are encrypted before being saved.</div>
            </div>
            <div className="field">
              <label htmlFor="terminal-passphrase">Key passphrase (optional)</label>
              <input
                id="terminal-passphrase"
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="form-actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save Terminal"}
          </button>
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
