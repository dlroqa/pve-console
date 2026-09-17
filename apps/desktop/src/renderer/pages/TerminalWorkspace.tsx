import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";
import type {
  TerminalDirectoryListing,
  TerminalLocation,
} from "../../terminal/terminal-types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { errorMessage, unwrap } from "../ipc";
import { parseSshCommand, pathFromOsc, quoteShellPath, type ParsedSshTarget } from "../terminal-command";

interface Props {
  profile?: SshProfile | null;
  onDeleted?: () => Promise<void>;
  onProfilesChanged?: () => Promise<void>;
  onProfileCreated?: (profile: SshProfile) => void;
  onClose?: () => void;
  targetId?: string;
  active?: boolean;
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

export function TerminalWorkspace({
  profile,
  onDeleted,
  onProfilesChanged,
  onProfileCreated,
  onClose,
  targetId,
  active = true,
}: Props): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const locationRef = useRef<TerminalLocation>("local");
  const lineRef = useRef("");
  const pathRef = useRef("");
  const reconnectLocalRef = useRef(true);
  const startedRef = useRef(false);
  const initialProfileRef = useRef(profile);
  const onProfilesChangedRef = useRef(onProfilesChanged);
  const onProfileCreatedRef = useRef(onProfileCreated);
  onProfilesChangedRef.current = onProfilesChanged;
  onProfileCreatedRef.current = onProfileCreated;
  const stableTargetId = useRef(targetId ?? window.crypto.randomUUID());
  const [status, setStatus] = useState<SshConnectionStatus>("connecting");
  const [location, setLocation] = useState<TerminalLocation>("local");
  const [path, setPath] = useState("");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [listing, setListing] = useState<TerminalDirectoryListing | null>(null);
  const [explorerError, setExplorerError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<ParsedSshTarget | null>(null);
  const [credential, setCredential] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [authType, setAuthType] = useState<"password" | "private-key">("password");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshDirectory = useCallback(async (nextPath?: string) => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    try {
      const result = await unwrap(window.pve.terminal.listDirectory(sessionId, nextPath));
      setListing(result);
      pathRef.current = result.path;
      setPath(result.path);
      setExplorerError(null);
    } catch (err) {
      setExplorerError(errorMessage(err));
    }
  }, []);

  const resize = useCallback(() => {
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (!terminal || !fit) return;
    fit.fit();
    if (sessionRef.current) {
      void window.pve.terminal.resize(sessionRef.current, terminal.cols, terminal.rows);
    }
  }, []);

  const startLocal = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setStatus("connecting");
    setLocation("local");
    locationRef.current = "local";
    const result = await unwrap(window.pve.terminal.startLocal({
      targetId: stableTargetId.current,
      cols: terminal.cols,
      rows: terminal.rows,
    }));
    sessionRef.current = result.sessionId;
    setStatus("connected");
    await refreshDirectory();
    terminal.focus();
  }, [refreshDirectory]);

  const connectProfile = useCallback(async (
    selected: SshProfile,
    suppliedCredential?: string,
    suppliedPassphrase?: string,
  ) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setError(null);
    setStatus("connecting");
    const previous = sessionRef.current;
    reconnectLocalRef.current = false;
    if (previous) await unwrap(window.pve.terminal.disconnect(previous));
    try {
      const result = await unwrap(window.pve.terminal.connect({
        profileId: selected.id,
        credential: suppliedCredential || undefined,
        passphrase: suppliedPassphrase || undefined,
        cols: terminal.cols,
        rows: terminal.rows,
      }));
      sessionRef.current = result.sessionId;
      locationRef.current = "remote";
      setLocation("remote");
      setStatus("connected");
      setPendingTarget(null);
      setCredential("");
      setPrivateKey("");
      setPassphrase("");
      reconnectLocalRef.current = true;
      await refreshDirectory(".");
      terminal.focus();
    } catch (err) {
      sessionRef.current = null;
      setStatus("error");
      setError(errorMessage(err));
      reconnectLocalRef.current = true;
      await startLocal();
    }
  }, [refreshDirectory, startLocal]);

  const connectParsedTarget = useCallback(async (
    parsed: ParsedSshTarget,
    suppliedCredential: string,
    suppliedAuthType: "password" | "private-key",
    suppliedPassphrase?: string,
  ) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const savedProfiles = await unwrap(window.pve.terminalProfiles.list());
    const existing = savedProfiles.find((item) =>
      item.username === parsed.username &&
      item.host.toLowerCase() === parsed.host.toLowerCase() &&
      item.port === parsed.port
    );
    if (existing && (existing.hasCredential || suppliedCredential)) {
      onProfileCreatedRef.current?.(existing);
      await connectProfile(existing, suppliedCredential, suppliedPassphrase);
      return;
    }
    if (!suppliedCredential) {
      setPendingTarget(parsed);
      setAuthType(existing?.authType ?? "password");
      return;
    }

    setStatus("connecting");
    setError(null);
    const saved = existing ?? await unwrap(window.pve.terminalProfiles.create({
      name: `${parsed.username}@${parsed.host}`,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      authType: suppliedAuthType,
      credential: suppliedCredential,
      passphrase: suppliedPassphrase || undefined,
      rememberCredential: true,
    }));
    await onProfilesChangedRef.current?.();
    onProfileCreatedRef.current?.(saved);
    await connectProfile(
      saved,
      saved.hasCredential ? undefined : suppliedCredential,
      saved.hasCredential ? undefined : suppliedPassphrase,
    );
  }, [connectProfile]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || startedRef.current) return;
    startedRef.current = true;
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

    const oscDisposable = terminal.parser.registerOscHandler(7, (value) => {
      const nextPath = pathFromOsc(value);
      if (nextPath) {
        pathRef.current = nextPath;
        setPath(nextPath);
        void refreshDirectory(nextPath);
      }
      return true;
    });
    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      if (data === "\r") {
        const command = lineRef.current.trim();
        lineRef.current = "";
        if (locationRef.current === "local") {
          const parsed = parseSshCommand(command);
          if (parsed) {
            void window.pve.terminal.write(sessionId, "\u0015");
            void connectParsedTarget(parsed, "", "password");
            return;
          }
        } else {
          const changeDirectory = command.match(/^cd(?:\s+--)?(?:\s+(.+))?$/);
          if (changeDirectory) {
            const rawTarget = (changeDirectory[1] || ".").replace(/^(['"])(.*)\1$/, "$2");
            const nextPath = rawTarget.startsWith("/") || rawTarget.startsWith("~")
              ? rawTarget
              : `${pathRef.current}/${rawTarget}`;
            window.setTimeout(() => void refreshDirectory(nextPath), 100);
          }
        }
      } else if (data === "\u007f") {
        lineRef.current = lineRef.current.slice(0, -1);
      } else if (data === "\u0015" || data === "\u0003" || data.startsWith("\u001b")) {
        lineRef.current = "";
      } else if (/^[\x20-\x7e]+$/.test(data)) {
        lineRef.current += data;
      }
      void window.pve.terminal.write(sessionId, data);
    });
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    const offData = window.pve.on("terminal:data", (payload) => {
      const event = payload as TerminalDataEvent;
      if (event.sessionId === sessionRef.current) terminal.write(event.data);
    });
    const offStatus = window.pve.on("terminal:status", (payload) => {
      const event = payload as TerminalStatusEvent;
      if (event.sessionId !== sessionRef.current) return;
      setStatus(event.status);
      if (event.message) setError(event.message);
      if (event.status === "disconnected") {
        sessionRef.current = null;
        if (locationRef.current === "remote" && reconnectLocalRef.current) {
          terminal.writeln("\r\n\x1b[90m[Remote session ended — returning to local shell]\x1b[0m");
          void startLocal();
        }
      }
    });

    const initialProfile = initialProfileRef.current;
    if (initialProfile?.hasCredential) {
      void connectProfile(initialProfile);
    } else {
      if (initialProfile) {
        setPendingTarget({ username: initialProfile.username, host: initialProfile.host, port: initialProfile.port });
        setAuthType(initialProfile.authType);
      }
      void startLocal();
    }

    return () => {
      reconnectLocalRef.current = false;
      if (sessionRef.current) void window.pve.terminal.disconnect(sessionRef.current);
      observer.disconnect();
      offData();
      offStatus();
      oscDisposable.dispose();
      inputDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [connectParsedTarget, connectProfile, refreshDirectory, resize, startLocal]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      resize();
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, resize]);

  const openDirectory = async (nextPath: string) => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    await window.pve.terminal.write(sessionId, `cd ${quoteShellPath(nextPath)}\r`);
    await refreshDirectory(nextPath);
  };

  const readPrivateKey = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setPrivateKey(await file.text());
  };

  const submitCredential = async () => {
    if (!pendingTarget) return;
    const secret = authType === "password" ? credential : privateKey;
    if (!secret) return;
    await connectParsedTarget(pendingTarget, secret, authType, passphrase);
  };

  const deleteProfile = async () => {
    if (!profile || !onDeleted) return;
    setDeleting(true);
    try {
      if (sessionRef.current) await unwrap(window.pve.terminal.disconnect(sessionRef.current));
      await unwrap(window.pve.terminalProfiles.delete(profile.id));
      await onDeleted();
    } catch (err) {
      setError(errorMessage(err));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const contextLabel = location === "local" ? "Local" : "SSH";
  const title = profile?.name ?? (location === "local" ? "Local Terminal" : "Remote Terminal");

  return (
    <div className="terminal-workspace">
      <div className="terminal-toolbar">
        <button
          className={explorerOpen ? "active" : ""}
          onClick={() => setExplorerOpen((value) => !value)}
          aria-label="Toggle file explorer"
          title="Toggle file explorer"
        >
          ▣
        </button>
        <div className="terminal-target">
          <strong>{title}</strong>
          <span>{contextLabel} · {path || "Starting shell…"}</span>
        </div>
        <span className={`terminal-state ${status}`}>{status}</span>
        <span className="spacer" />
        <button onClick={resize}>Fit</button>
        {profile && onDeleted && <button className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>}
        {onClose && <button onClick={onClose}>Close</button>}
      </div>

      {pendingTarget && (
        <div className="terminal-authbar">
          <strong>{pendingTarget.username}@{pendingTarget.host}:{pendingTarget.port}</strong>
          <select value={authType} onChange={(event) => setAuthType(event.target.value as "password" | "private-key")}>
            <option value="password">Password</option>
            <option value="private-key">Private key</option>
          </select>
          {authType === "password" ? (
            <input
              autoFocus
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitCredential();
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
          <button className="primary" onClick={() => void submitCredential()}>Connect</button>
          <button onClick={() => setPendingTarget(null)}>Cancel</button>
          <span>Saved securely when OS encryption is available.</span>
        </div>
      )}
      {error && <div className="terminal-error">{error}</div>}

      <div className="terminal-body">
        {explorerOpen && (
          <aside className="terminal-explorer" aria-label={`${contextLabel} file explorer`}>
            <div className="terminal-explorer-head">
              <button
                disabled={!listing?.parentPath}
                onClick={() => listing?.parentPath && void openDirectory(listing.parentPath)}
                aria-label="Parent directory"
              >
                ↑
              </button>
              <span title={listing?.path}>{listing?.path || path || "Files"}</span>
              <button onClick={() => void refreshDirectory(listing?.path)} aria-label="Refresh directory">↻</button>
            </div>
            {explorerError ? (
              <div className="terminal-explorer-error">{explorerError}</div>
            ) : (
              <div className="terminal-file-list">
                {listing?.entries.map((entry) => (
                  <button
                    key={entry.path}
                    className={`terminal-file ${entry.kind}`}
                    disabled={entry.kind !== "directory"}
                    onDoubleClick={() => entry.kind === "directory" && void openDirectory(entry.path)}
                    title={entry.path}
                  >
                    <span>{entry.kind === "directory" ? "▸" : ""}</span>
                    <span>{entry.kind === "directory" ? "▱" : "·"}</span>
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}
        <div className="terminal-surface" ref={mountRef} />
      </div>

      {confirmDelete && profile && (
        <ConfirmDialog
          title="Delete SSH connection?"
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
