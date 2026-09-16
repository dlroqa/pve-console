import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorMessage, unwrap } from "../ipc";

interface Props {
  profile: SshProfile;
  onDeleted: () => Promise<void>;
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

export function TerminalWorkspace({ profile, onDeleted }: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [credential, setCredential] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState<SshConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    terminal.writeln(`PVE Console SSH — ${profile.username}@${profile.host}`);
    terminal.writeln("Press Connect to start a session.\r\n");

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
      if (event.profileId !== profile.id) return;
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
  }, [profile.host, profile.id, profile.username, resize]);

  const connect = async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setError(null);
    setStatus("connecting");
    terminal.writeln("\r\n\x1b[90m[Connecting…]\x1b[0m");
    resize();
    try {
      const { sessionId } = await unwrap(
        window.pve.terminal.connect({
          profileId: profile.id,
          credential: credential || undefined,
          passphrase: passphrase || undefined,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
      sessionRef.current = sessionId;
      setStatus("connected");
      setCredential("");
      setPassphrase("");
      terminal.focus();
    } catch (err) {
      setStatus("error");
      setError(errorMessage(err));
    }
  };

  const disconnect = async () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    await unwrap(window.pve.terminal.disconnect(sessionId));
    sessionRef.current = null;
    setStatus("disconnected");
  };

  const deleteProfile = async () => {
    setDeleting(true);
    try {
      const sessionId = sessionRef.current;
      if (sessionId) await unwrap(window.pve.terminal.disconnect(sessionId));
      await unwrap(window.pve.terminalProfiles.delete(profile.id));
      await onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const connected = status === "connected";
  return (
    <div className="terminal-workspace">
      <div className="terminal-toolbar">
        <div className="terminal-target">
          <strong>{profile.name}</strong>
          <span>{profile.username}@{profile.host}:{profile.port}</span>
        </div>
        <span className={`terminal-state ${status}`}>{status}</span>
        <span className="spacer" />
        <button onClick={resize} disabled={!connected}>Fit</button>
        {connected ? (
          <button onClick={() => void disconnect()}>Disconnect</button>
        ) : (
          <button className="primary" onClick={() => void connect()} disabled={status === "connecting"}>
            {status === "connecting" ? "Connecting…" : "Connect"}
          </button>
        )}
        <button className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>
      </div>

      {!profile.hasCredential && !connected && (
        <div className="terminal-authbar">
          {profile.authType === "password" ? (
            <input
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder={`Password for ${profile.username}`}
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void connect();
              }}
            />
          ) : (
            <>
              <label className="key-picker">
                Private key
                <input
                  type="file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void file.text().then(setCredential);
                  }}
                />
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete SSH terminal?"
          message={`Delete ${profile.name} and its encrypted credential?`}
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
