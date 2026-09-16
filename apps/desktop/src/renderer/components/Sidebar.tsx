import type { ServerProfile } from "../../profiles/profile-types";
import type { Route, StatusMap } from "../types";
import { ServerStatus } from "./ServerStatus";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";

interface Props {
  profiles: ServerProfile[];
  statuses: StatusMap;
  terminalProfiles: SshProfile[];
  terminalStatuses: Record<string, SshConnectionStatus>;
  route: Route;
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  onSelectTerminal: (id: string) => void;
  onNavigate: (route: Route) => void;
}

export function Sidebar({
  profiles,
  statuses,
  terminalProfiles,
  terminalStatuses,
  route,
  activeServerId,
  onSelectServer,
  onSelectTerminal,
  onNavigate,
}: Props): JSX.Element {
  return (
    <nav className="sidebar">
      <div className="section-label">Servers</div>
      {profiles.length === 0 && (
        <div style={{ padding: "0 10px", color: "var(--text-faint)", fontSize: 13 }}>
          No servers yet.
        </div>
      )}
      {profiles.map((p) => {
        const active = activeServerId === p.id && route.name === "workspace";
        return (
          <button
            key={p.id}
            className={`nav-item ${active ? "active" : ""}`}
            onClick={() => onSelectServer(p.id)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
              <ServerStatus status={statuses[p.id] ?? "disconnected"} />
            </div>
          </button>
        );
      })}

      <button className="nav-item" onClick={() => onNavigate({ name: "add" })}>
        + Add Server
      </button>

      <div className="section-label terminal-section-label">Terminal</div>
      {terminalProfiles.length === 0 && (
        <div className="sidebar-empty">No SSH connections yet.</div>
      )}
      {terminalProfiles.map((profile) => {
        const active = route.name === "terminal" && route.profileId === profile.id;
        const status = terminalStatuses[profile.id] ?? "disconnected";
        return (
          <button
            key={profile.id}
            className={`nav-item ${active ? "active" : ""}`}
            onClick={() => onSelectTerminal(profile.id)}
          >
            <span className={`dot terminal-dot ${status}`} />
            <span className="terminal-nav-copy">
              <span>{profile.name}</span>
              <small>{profile.username}@{profile.host}</small>
            </span>
          </button>
        );
      })}
      <button className="nav-item" onClick={() => onNavigate({ name: "terminal-add" })}>
        + Add Terminal
      </button>

      <div className="footer">
        <div className="section-label">App</div>
        <button
          className={`nav-item ${route.name === "diagnostics" ? "active" : ""}`}
          onClick={() => onNavigate({ name: "diagnostics", serverId: activeServerId ?? undefined })}
        >
          Diagnostics
        </button>
        <button
          className={`nav-item ${route.name === "settings" ? "active" : ""}`}
          onClick={() => onNavigate({ name: "settings" })}
        >
          Settings
        </button>
      </div>
    </nav>
  );
}
