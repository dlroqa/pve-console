import { useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this exact text to enable confirmation (strong confirmation). */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog for destructive/interrupting actions (spec §11).
 * Supports a stronger "type-to-confirm" mode for high-risk operations.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  requireText,
  busy,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const [typed, setTyped] = useState("");
  const canConfirm = !busy && (!requireText || typed === requireText);

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>{title}</h2>
        <p style={{ color: "var(--text-dim)", marginTop: 0 }}>{message}</p>

        {requireText && (
          <div className="field">
            <label>
              Type <strong>{requireText}</strong> to confirm
            </label>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}

        <div className="actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
