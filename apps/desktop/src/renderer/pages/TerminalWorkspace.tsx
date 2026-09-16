import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { CreateSshProfileInput, SshAuthType, SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorMessage, unwrap } from "../ipc";

interface Props {
  profile?: SshProfile | null;
  onDeleted?: () => Promise<void>;
  onProfilesChanged?: () => Promise<void>;
}

interface TerminalDataEvent {
  sessionId: string;
  data: string;
}

interface TerminalStatusEvent {
  profileId: string;
  sessionId?: string;
  status: SshConnectionStatus;
  message?: string;
}

function defaultDirectId(): string {
  return `direct:${window.crypto.randomUUID()}`;
}

function defaultName(username: string, host: string): string {
  const user = username.trim();
  const target = host.trim();
  return user && target ? `${user}@${target}` : "SSH terminal";
}

export function TerminalWorkspace({ profile, onDeleted, onProfilesChanged }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const directTargetIdRef = useRef(defaultDirectId());
  const activeTargetIdRef = useRef(profile?.id ?? directTargetIdRef.current);
  const [currentProfile, setCurrentProfile] = useState<SshProfile | null>(profile ?? null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<SshAuthType>("password");
  const [credential, setCredential] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saveConnection, setSaveConnection] = useState(false);
  const [status, setStatus] = useState<SshConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setCurrentProfile(profile ?? null);
    activeTargetIdRef.current = profile?.id ?? directTargetIdRef.current;
    setStatus("disconnected");
    setError(null);
  }, [profile]);

  const resize = useCallback(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    fit.fit();
    const sessionId = sessionRef.current;
    if (sessionId) void window.pve.terminal.resize(sessionId, terminal.cols, terminal.rows);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
      fontSize: 14,
      scrollback: 10_000,
      theme: {
        background: "#0b0d10",
        foreground: "#e6e9ee",
        cursor: "#4c8dff",
        selectionBackground: "#2f5bb7aa",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(mount);
    terminalRef.current = terminal;
    fitRef.current = fit;
    fit.fit();
    terminal.writeln("PVE Console SSH");
    terminal.writeln("Enter an SSH target above, then connect.\r\n");
    hostInputRef.current?.focus();

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (sessionId) void window.pve.terminal.write(sessionId, data);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const offData = window.pve.on("terminal:data", (payload) => {
      const event = payload as TerminalDataEvent;
      if (event.sessionId === sessionRef.current) terminal.write(event.data);
    });
    const offStatus = window.pve.on("terminal:status", (payload) => {
      const event = payload as TerminalStatusEvent;
      if (event.profileId !== activeTargetIdRef.current) return;
      if (event.sessionId && sessionRef.current && event.sessionId !== sessionRef.current) return;
      setStatus(event.status);
      if (event.message) setError(event.message);
      if (event.status === "disconnected" && event.sessionId === sessionRef.current) {
        sessionRef.current = null;
        terminal.writeln("\r\n\x1b[90m[Disconnected]\x1b[0m");
      }
    });

    return () => {
      const sessionId = sessionRef.current;
      if (sessionId) void window.pve.terminal.disconnect(sessionId);
      observer.disconnect();
      offData();
      offStatus();
      inputDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [resize]);

  const readPrivateKey = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setCredential(await file.text());
  };

  const connect = async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setError(null);
    setStatus("connecting");
    terminal.writeln("\r\n\x1b[90m[Connecting...]\x1b[0m");
    resize();
    try {
      let result: { sessionId: string; profileId: string };
      if (currentProfile) {
        activeTargetIdRef.current = currentProfile.id;
        result = await unwrap(
          window.pve.terminal.connect({
            profileId: currentProfile.id,
            credential: credential || undefined,
            passphrase: passphrase || undefined,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      } else if (saveConnection) {
        const input: CreateSshProfileInput = {
          name: name.trim() || defaultName(username, host),
          host,
          port: Number(port),
          username,
          authType,
          credential,
          passphrase: passphrase || undefined,
          rememberCredential: true,
        };
        const saved = await unwrap(window.pve.terminalProfiles.create(input));
        setCurrentProfile(saved);
        activeTargetIdRef.current = saved.id;
        await onProfilesChanged?.();
        result = await unwrap(
          window.pve.terminal.connect({
            profileId: saved.id,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      } else {
        activeTargetIdRef.current = directTargetIdRef.current;
        result = await unwrap(
          window.pve.terminal.connectDirect({
            targetId: directTargetIdRef.current,
            name: name.trim() || undefined,
            host,
            port: Number(port),
            username,
            authType,
            credential,
            passphrase: passphrase || undefined,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        );
      }
      sessionRef.current = result.sessionId;
      activeTargetIdRef.current = result.profileId;
      setStatus("connected");
      setCredential("");
      setPassphrase("");
      terminal.focus();
    } catch (err) {
      setStatus("error");
      setError(errorMessage(err));
    }
  };

  const submitConnect = (event: FormEvent) => {
    event.preventDefault();
    void connect();
  };

  const disconnect = async () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    await unwrap(window.pve.terminal.disconnect(sessionId));
    sessionRef.current = null;
    setStatus("disconnected");
  };

  const deleteProfile = async () => {
    if (!currentProfile || !onDeleted) return;
    setDeleting(true);
    try {
      const sessionId = sessionRef.current;
      if (sessionId) await unwrap(window.pve.terminal.disconnect(sessionId));
      await unwrap(window.pve.terminalProfiles.delete(currentProfile.id));
      await onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const connected = status === "connected";
  const targetLabel = currentProfile?.name ?? (name.trim() || "New SSH terminal");
  const targetAddress = currentProfile
    ? `${currentProfile.username}@${currentProfile.host}:${currentProfile.port}`
    : host.trim()
      ? `${username.trim() || "user"}@${host.trim()}:${port || "22"}`
      : "remote SSH";
  const needsSavedCredential = currentProfile && !currentProfile.hasCredential && !connected;

  return (
    <div className="terminal-workspace">
      <div className="terminal-toolbar">
        <div className="terminal-target">
          <strong>{targetLabel}</strong>
          <span>{targetAddress}</span>
        </div>
        <span className={`terminal-state ${status}`}>{status}</span>
        <span className="spacer" />
        <button onClick={resize} disabled={!connected}>Fit</button>
        {connected ? (
          <button onClick={() => void disconnect()}>Disconnect</button>
        ) : currentProfile ? (
          <button className="primary" onClick={() => void connect()} disabled={status === "connecting"}>
            {status === "connecting" ? "Connecting..." : "Connect"}
          </button>
        ) : null}
        {currentProfile && onDeleted && (
          <button className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
      </div>

      {!currentProfile && !connected && (
        <form className="terminal-connectbar" onSubmit={submitConnect}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name"
            aria-label="Terminal name"
          />
          <input
            ref={hostInputRef}
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="Host or IP"
            aria-label="SSH host"
            required
          />
          <input
            className="terminal-port-input"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            aria-label="SSH port"
            required
          />
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="User"
            aria-label="SSH username"
            autoComplete="username"
            required
          />
          <select
            value={authType}
            onChange={(event) => {
              setAuthType(event.target.value as SshAuthType);
              setCredential("");
            }}
            aria-label="SSH authentication type"
          >
            <option value="password">Password</option>
            <option value="private-key">Private key</option>
          </select>
          {authType === "password" ? (
            <input
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          ) : (
            <>
              <label className="key-picker compact">
                Key
                <input type="file" onChange={readPrivateKey} required={!credential} />
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="Passphrase"
              />
            </>
          )}
          <label className="checkbox terminal-save-toggle">
            <input
              type="checkbox"
              checked={saveConnection}
              onChange={(event) => setSaveConnection(event.target.checked)}
            />
            Save
          </label>
          <button className="primary" type="submit" disabled={status === "connecting"}>
            {status === "connecting" ? "Connecting..." : "Connect"}
          </button>
        </form>
      )}

      {needsSavedCredential && (
        <div className="terminal-authbar">
          {currentProfile.authType === "password" ? (
            <input
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={`Password for ${currentProfile.username}`}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
            />
          ) : (
            <>
              <label className="key-picker">
                Private key
                <input type="file" onChange={readPrivateKey} />
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="Key passphrase (optional)"
              />
            </>
          )}
          <span>Credential is used for this session only.</span>
        </div>
      )}
      {error && <div className="terminal-error">{error}</div>}
      <div className="terminal-surface" ref={mountRef} />

      {confirmDelete && currentProfile && (
        <ConfirmDialog
          title="Delete SSH terminal?"
          message={`Delete ${currentProfile.name} and its encrypted credential?`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void deleteProfile()}
        />
      )}
    </div>
  );
}
