import type { ServerProfile } from "../../profiles/profile-types";
import type { ServerStatus as Status } from "../../shared/types";
import { ServerStatus } from "./ServerStatus";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";
import { AiUsageIndicator } from "./AiUsageIndicator";

interface Props {
  activeProfile: ServerProfile | null;
  status: Status | null;
  activeTerminal?: SshProfile | null;
  activeTerminalLabel?: string;
  terminalStatus?: SshConnectionStatus | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function Topbar({
  activeProfile,
  status,
  activeTerminal,
  activeTerminalLabel,
  terminalStatus,
  sidebarOpen,
  onToggleSidebar,
}: Props): JSX.Element {
  const description = activeProfile
    ? `${activeProfile.name} · ${activeProfile.host}:${activeProfile.port}`
    : activeTerminal
      ? `${activeTerminal.name} · ${activeTerminal.username}@${activeTerminal.host}:${activeTerminal.port}`
      : activeTerminalLabel
        ? activeTerminalLabel
        : "No server selected";
  return (
    <header className="topbar">
      <button
        className="sidebar-toggle ghost"
        onClick={onToggleSidebar}
        aria-controls="primary-sidebar"
        aria-expanded={sidebarOpen}
        aria-label={(sidebarOpen ? "Hide" : "Show") + " navigation sidebar"}
        title={(sidebarOpen ? "Hide" : "Show") + " Servers and Terminal sidebar"}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <span className="brand">PVE Console</span>
      <span className="active-server">{description}</span>
      <span className="spacer" />
      <AiUsageIndicator />
      {activeProfile && status && <ServerStatus status={status} />}
      {(activeTerminal || activeTerminalLabel) && terminalStatus && (
        <span className={`terminal-state ${terminalStatus}`}>{terminalStatus}</span>
      )}
    </header>
  );
}
