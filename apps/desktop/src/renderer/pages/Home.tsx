import type { ServerProfile } from "../../profiles/profile-types";
import type { StatusMap } from "../types";
import { ServerCard } from "../components/ServerCard";

interface Props {
  profiles: ServerProfile[];
  statuses: StatusMap;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
}

export function Home({ profiles, statuses, onOpen, onEdit, onAdd }: Props): JSX.Element {
  return (
    <div className="page">
      <h1>PVE Console</h1>
      <p className="subtitle">Your configured Proxmox servers.</p>

      {profiles.length === 0 ? (
        <div className="empty">
          <p>No servers configured yet.</p>
          <button className="primary" onClick={onAdd}>
            + Add Server
          </button>
        </div>
      ) : (
        <>
          <div className="card-grid">
            {profiles.map((p) => (
              <ServerCard
                key={p.id}
                profile={p}
                status={statuses[p.id] ?? "disconnected"}
                onOpen={() => onOpen(p.id)}
                onEdit={() => onEdit(p.id)}
              />
            ))}
          </div>
          <div style={{ marginTop: 18 }}>
            <button className="primary" onClick={onAdd}>
              + Add Server
            </button>
          </div>
        </>
      )}
    </div>
  );
}
