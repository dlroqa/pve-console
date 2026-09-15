import type { ServerProfile } from "../../profiles/profile-types";
import type { ServerStatus as Status } from "../../shared/types";
import { ServerStatus } from "./ServerStatus";

interface Props {
  profile: ServerProfile;
  status: Status;
  onOpen: () => void;
  onEdit: () => void;
}

export function ServerCard({ profile, status, onOpen, onEdit }: Props): JSX.Element {
  return (
    <div className="card server-card" onClick={onOpen}>
      <div className="name">{profile.name}</div>
      <div className="addr">
        {profile.protocol}://{profile.host}:{profile.port}
      </div>
      <div className="row">
        <ServerStatus status={status} />
        <button
          className="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}
