import type { SshHostKeyDecision, SshHostKeyPrompt } from "../../ssh/ssh-types";

interface Props {
  prompt: SshHostKeyPrompt;
  onDecide: (decision: SshHostKeyDecision) => void;
}

export function SshHostKeyDialog({ prompt, onDecide }: Props): JSX.Element {
  const changed = Boolean(prompt.previousFingerprint);
  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>{changed ? "SSH host key changed" : "Verify SSH host"}</h2>
        <div className="warn-banner">
          {changed
            ? "The host key no longer matches the saved key. Continue only if the VM was rebuilt or its SSH key was intentionally changed."
            : "Confirm this fingerprint with the VM administrator before connecting."}
        </div>
        <p>
          <strong>{prompt.profileName}</strong> — {prompt.host}:{prompt.port}
        </p>
        {prompt.previousFingerprint && (
          <>
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Previously trusted</div>
            <div className="kv">{prompt.previousFingerprint}</div>
          </>
        )}
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Presented fingerprint</div>
        <div className="kv">{prompt.fingerprint}</div>
        <div className="actions">
          <button onClick={() => onDecide("cancel")}>Cancel</button>
          <button onClick={() => onDecide("trust-once")}>Trust once</button>
          <button className="primary" onClick={() => onDecide("trust-and-save")}>
            Trust and save
          </button>
        </div>
      </div>
    </div>
  );
}
