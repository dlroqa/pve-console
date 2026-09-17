import type { ServerProfile } from "../../profiles/profile-types";
import type { ServerStatus as Status } from "../../shared/types";
import { ServerStatus } from "./ServerStatus";
import type { SshConnectionStatus, SshProfile } from "../../ssh/ssh-types";

interface Props {
  activeProfile: ServerProfile | null;
  status: Status | null;
  activeTerminal?: SshProfile | null;
  activeTerminalLabel?: string;
  terminalStatus?: SshConnectionStatus | null;
}

export function Topbar({
  activeProfile,
  status,
  activeTerminal,
  activeTerminalLabel,
  terminalStatus,
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
      <span className="brand">PVE Console</span>
      <span className="active-server">{description}</span>
      <span className="spacer" />
      {activeProfile && status && <ServerStatus status={status} />}
      {(activeTerminal || activeTerminalLabel) && terminalStatus && (
        <span className={`terminal-state ${terminalStatus}`}>{terminalStatus}</span>
      )}
    </header>
  );
}
