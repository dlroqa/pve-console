import type { ServerStatus as Status } from "../../shared/types";

const LABELS: Record<Status, string> = {
  connected: "Connected",
  connecting: "Connecting",
  disconnected: "Disconnected",
  "certificate-warning": "Certificate changed",
  offline: "Offline",
};

export function ServerStatus({ status }: { status: Status }): JSX.Element {
  return (
    <span className="status">
      <span className={`dot ${status}`} />
      {LABELS[status]}
    </span>
  );
}
