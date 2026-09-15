import type { ServerProfile } from "../../profiles/profile-types";
import type { ServerStatus as Status } from "../../shared/types";
import { ServerStatus } from "./ServerStatus";

interface Props {
  activeProfile: ServerProfile | null;
  status: Status | null;
}

export function Topbar({ activeProfile, status }: Props): JSX.Element {
  return (
    <header className="topbar">
      <span className="brand">PVE Console</span>
      <span className="active-server">
        {activeProfile ? `${activeProfile.name} · ${activeProfile.host}:${activeProfile.port}` : "No server selected"}
      </span>
      <span className="spacer" />
      {activeProfile && status && <ServerStatus status={status} />}
    </header>
  );
}
