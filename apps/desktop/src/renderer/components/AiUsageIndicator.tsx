import { useCallback, useEffect, useState } from "react";
import type { AiStatus } from "../../ai/ai-types";
import { unwrap } from "../ipc";

function remaining(reset?: string): string {
  if (!reset) return "window starts on first use";
  const milliseconds = Math.max(0, Date.parse(reset) - Date.now());
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.ceil((milliseconds % 3_600_000) / 60_000);
  return `resets in ${hours}h ${minutes}m`;
}

export function AiUsageIndicator(): JSX.Element | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(() => {
    void unwrap(window.pve.ai.getStatus()).then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("pve:ai-usage", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pve:ai-usage", refresh);
    };
  }, [refresh]);
  if (!status) return null;
  const provider = status.provider === "openai" ? "Codex" : "Claude";
  return (
    <div className={`ai-usage-indicator ${status.configured ? "ready" : ""}`} title={`${provider} subscription via official CLI. Local PVE Console requests only; not authoritative account allowance.`}>
      <span className="ai-pulse">⌁</span>
      <span>{provider}</span>
      <span>{status.localUsage.requests} used</span>
      <span>{remaining(status.localUsage.resetsAt)}</span>
    </div>
  );
}
