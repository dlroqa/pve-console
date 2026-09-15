import { useEffect, useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import { ServerForm, type ServerFormValues } from "../components/ServerForm";
import { unwrap, errorMessage } from "../ipc";

interface Props {
  serverId: string;
  onSaved: () => void;
  onDeleted: () => void;
  onCancel: () => void;
}

export function EditServer({ serverId, onSaved, onDeleted, onCancel }: Props): JSX.Element {
  const [profile, setProfile] = useState<ServerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    unwrap(window.pve.profiles.get(serverId))
      .then((p) => {
        if (active) setProfile(p ?? null);
      })
      .catch((e) => active && setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [serverId]);

  const handleSubmit = async (values: ServerFormValues) => {
    await unwrap(window.pve.profiles.update(serverId, values));
    onSaved();
  };

  const handleDelete = async () => {
    try {
      await unwrap(window.pve.profiles.delete(serverId));
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (error) return <div className="page"><div className="banner error">{error}</div></div>;
  if (!profile) return <div className="page"><div className="empty">Loading…</div></div>;

  return (
    <div className="page">
      <h1>Edit Server</h1>
      <p className="subtitle">{profile.name}</p>
      <ServerForm
        initial={profile}
        submitLabel="Save Changes"
        onSubmit={handleSubmit}
        onCancel={onCancel}
      />

      <div style={{ marginTop: 28, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
        {!confirmDelete ? (
          <button className="danger" onClick={() => setConfirmDelete(true)}>
            Delete Server
          </button>
        ) : (
          <div className="banner error">
            <p style={{ marginTop: 0 }}>
              Delete “{profile.name}”? This removes the profile and its pinned certificate. The
              server itself is not affected.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="danger" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
