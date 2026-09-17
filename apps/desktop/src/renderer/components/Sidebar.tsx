import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { Route, StatusMap } from "../types";
import { ServerStatus } from "./ServerStatus";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";

export interface OpenTerminalSummary {
  id: string;
  label: string;
  profileId?: string;
  address?: string;
  status: SshConnectionStatus;
}

interface Props {
  profiles: ServerProfile[];
  statuses: StatusMap;
  terminalProfiles: SshProfile[];
  terminalStatuses: Record<string, SshConnectionStatus>;
  openTerminals: OpenTerminalSummary[];
  route: Route;
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  onSelectTerminal: (id: string) => void;
  onSelectOpenTerminal: (id: string) => void;
  onRenameServer: (id: string, name: string) => Promise<void>;
  onRenameTerminal: (id: string, name: string, profileId?: string) => Promise<void>;
  onNavigate: (route: Route) => void;
}

interface RenameableItemProps {
  itemKey: string;
  name: string;
  active?: boolean;
  children: JSX.Element;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
}

function RenameableItem({
  itemKey,
  name,
  active = false,
  children,
  onOpen,
  onRename,
}: RenameableItemProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  const save = async () => {
    const normalized = draft.trim();
    if (!normalized || normalized === name || busy) {
      if (normalized === name) setEditing(false);
      return;
    }
    setBusy(true);
    setRenameError(null);
    try {
      await onRename(normalized);
      setEditing(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <div
      className={`nav-item renameable-nav-item ${active ? "active" : ""}`}
      data-item-key={itemKey}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="sidebar-rename-input"
          value={draft}
          maxLength={80}
          aria-label={`Rename ${name}`}
          aria-invalid={Boolean(renameError)}
          title={renameError ?? undefined}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => void save()}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <button className="sidebar-nav-open" onClick={onOpen}>
          {children}
        </button>
      )}
      {!editing && (
        <button
          className="sidebar-rename-button"
          aria-label={`Rename ${name}`}
          title="Rename"
          onClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
        >
          ✎
        </button>
      )}
    </div>
  );
}

export function Sidebar({
  profiles,
  statuses,
  terminalProfiles,
  terminalStatuses,
  openTerminals,
  route,
  activeServerId,
  onSelectServer,
  onSelectTerminal,
  onSelectOpenTerminal,
  onRenameServer,
  onRenameTerminal,
  onNavigate,
}: Props): JSX.Element {
  const openProfileIds = new Set(
    openTerminals.flatMap((terminal) => terminal.profileId ? [terminal.profileId] : []),
  );
  const savedProfiles = terminalProfiles.filter((profile) => !openProfileIds.has(profile.id));

  return (
    <nav className="sidebar" id="primary-sidebar" aria-label="Servers and terminals">
      <div className="section-label">Servers</div>
      {profiles.length === 0 && <div className="sidebar-empty">No servers yet.</div>}
      {profiles.map((profile) => (
        <RenameableItem
          key={profile.id}
          itemKey={`server:${profile.id}`}
          name={profile.name}
          active={activeServerId === profile.id && route.name === "workspace"}
          onOpen={() => onSelectServer(profile.id)}
          onRename={(name) => onRenameServer(profile.id, name)}
        >
          <div className="server-nav-copy">
            <span>{profile.name}</span>
            <ServerStatus status={statuses[profile.id] ?? "disconnected"} />
          </div>
        </RenameableItem>
      ))}
      <button className="nav-item" onClick={() => onNavigate({ name: "add" })}>+ Add Server</button>

      <div className="section-label terminal-section-label">Terminal</div>
      {openTerminals.length === 0 && savedProfiles.length === 0 && (
        <div className="sidebar-empty">No SSH connections yet.</div>
      )}
      {openTerminals.map((terminal) => (
        <RenameableItem
          key={terminal.id}
          itemKey={`terminal:${terminal.id}`}
          name={terminal.label}
          active={route.name === "terminal-session" && route.terminalId === terminal.id}
          onOpen={() => onSelectOpenTerminal(terminal.id)}
          onRename={(name) => onRenameTerminal(terminal.id, name, terminal.profileId)}
        >
          <>
            <span className={`dot terminal-dot ${terminal.status}`} />
            <span className="terminal-nav-copy">
              <span>{terminal.label}</span>
              <small>{terminal.address ?? "Local shell"}</small>
            </span>
          </>
        </RenameableItem>
      ))}
      {savedProfiles.map((profile) => (
        <RenameableItem
          key={profile.id}
          itemKey={`saved-terminal:${profile.id}`}
          name={profile.name}
          onOpen={() => onSelectTerminal(profile.id)}
          onRename={(name) => onRenameTerminal(profile.id, name, profile.id)}
        >
          <>
            <span className={`dot terminal-dot ${terminalStatuses[profile.id] ?? "disconnected"}`} />
            <span className="terminal-nav-copy">
              <span>{profile.name}</span>
              <small>{profile.username}@{profile.host}</small>
            </span>
          </>
        </RenameableItem>
      ))}
      <button className="nav-item" onClick={() => onNavigate({ name: "terminal-session", terminalId: "new" })}>
        + Terminal
      </button>

      <div className="footer">
        <div className="section-label">App</div>
        <button className={`nav-item ${route.name === "diagnostics" ? "active" : ""}`} onClick={() => onNavigate({ name: "diagnostics", serverId: activeServerId ?? undefined })}>Diagnostics</button>
        <button className={`nav-item ${route.name === "settings" ? "active" : ""}`} onClick={() => onNavigate({ name: "settings" })}>Settings</button>
      </div>
    </nav>
  );
}
