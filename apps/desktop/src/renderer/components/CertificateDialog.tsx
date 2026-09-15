import type { CertificatePromptPayload } from "../types";

interface Props {
  prompt: CertificatePromptPayload;
  onDecide: (decision: "cancel" | "trust-once" | "trust-and-pin" | "replace-pin") => void;
}

/** Certificate verification / change dialog (spec §14.1, §14.4). */
export function CertificateDialog({ prompt, onDecide }: Props): JSX.Element {
  const { observed } = prompt;
  const isMismatch = prompt.status === "mismatch";

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        {isMismatch ? (
          <>
            <h2>⚠ Server certificate changed</h2>
            <div className="warn-banner">
              Do not continue unless this certificate change is expected. The server at{" "}
              {prompt.host}:{prompt.port} is presenting a different certificate than the one you
              pinned.
            </div>
            <div className="field">
              <label>Previous fingerprint</label>
              <div className="kv">{prompt.previousFingerprint}</div>
            </div>
            <div className="field">
              <label>Current fingerprint</label>
              <div className="kv">{observed.fingerprintSha256}</div>
            </div>
            <div className="actions">
              <button onClick={() => onDecide("cancel")}>Cancel</button>
              <button onClick={() => onDecide("cancel")}>Review</button>
              <button className="danger" onClick={() => onDecide("replace-pin")}>
                Replace Pin
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>Certificate verification</h2>
            <div className="field">
              <label>Server</label>
              <div className="kv">
                {prompt.host}:{prompt.port}
              </div>
            </div>
            {observed.subject && (
              <div className="field">
                <label>Subject</label>
                <div className="kv">{observed.subject}</div>
              </div>
            )}
            {observed.issuer && (
              <div className="field">
                <label>Issuer</label>
                <div className="kv">{observed.issuer}</div>
              </div>
            )}
            <div className="field">
              <label>SHA-256 fingerprint</label>
              <div className="kv">{observed.fingerprintSha256}</div>
            </div>
            <div className="actions">
              <button onClick={() => onDecide("cancel")}>Cancel</button>
              <button onClick={() => onDecide("trust-once")}>Trust Once</button>
              <button className="primary" onClick={() => onDecide("trust-and-pin")}>
                Trust &amp; Pin
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
