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
  onNavigate: (route: Route) => void;
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
  onNavigate,
}: Props): JSX.Element {
  const openProfileIds = new Set(
    openTerminals.flatMap((terminal) => terminal.profileId ? [terminal.profileId] : []),
  );
  const savedProfiles = terminalProfiles.filter((profile) => !openProfileIds.has(profile.id));
  return (
    <nav className="sidebar">
      <div className="section-label">Servers</div>
      {profiles.length === 0 && <div className="sidebar-empty">No servers yet.</div>}
      {profiles.map((profile) => {
        const active = activeServerId === profile.id && route.name === "workspace";
        return (
          <button key={profile.id} className={`nav-item ${active ? "active" : ""}`} onClick={() => onSelectServer(profile.id)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{profile.name}</span>
              <ServerStatus status={statuses[profile.id] ?? "disconnected"} />
            </div>
          </button>
        );
      })}
      <button className="nav-item" onClick={() => onNavigate({ name: "add" })}>+ Add Server</button>

      <div className="section-label terminal-section-label">Terminal</div>
      {openTerminals.length === 0 && savedProfiles.length === 0 && (
        <div className="sidebar-empty">No SSH connections yet.</div>
      )}
      {openTerminals.map((terminal) => (
        <button
          key={terminal.id}
          className={`nav-item ${route.name === "terminal-session" && route.terminalId === terminal.id ? "active" : ""}`}
          onClick={() => onSelectOpenTerminal(terminal.id)}
        >
          <span className={`dot terminal-dot ${terminal.status}`} />
          <span className="terminal-nav-copy">
            <span>{terminal.label}</span>
            <small>{terminal.address ?? "New SSH session"}</small>
          </span>
        </button>
      ))}
      {savedProfiles.map((profile) => (
        <button key={profile.id} className="nav-item" onClick={() => onSelectTerminal(profile.id)}>
          <span className={`dot terminal-dot ${terminalStatuses[profile.id] ?? "disconnected"}`} />
          <span className="terminal-nav-copy">
            <span>{profile.name}</span>
            <small>{profile.username}@{profile.host}</small>
          </span>
        </button>
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
