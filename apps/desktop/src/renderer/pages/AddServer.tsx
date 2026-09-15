import { ServerForm, type ServerFormValues } from "../components/ServerForm";
import { unwrap } from "../ipc";

interface Props {
  onSaved: () => void;
  onCancel: () => void;
}

export function AddServer({ onSaved, onCancel }: Props): JSX.Element {
  const handleSubmit = async (values: ServerFormValues) => {
    await unwrap(window.pve.profiles.create(values));
    onSaved();
  };

  return (
    <div className="page">
      <h1>Add Proxmox Server</h1>
      <p className="subtitle">Configure a server by IP address or domain.</p>
      <ServerForm submitLabel="Save Server" onSubmit={handleSubmit} onCancel={onCancel} />
    </div>
  );
}
