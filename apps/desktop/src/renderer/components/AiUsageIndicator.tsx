import { useCallback, useEffect, useState } from "react";
import type { AiStatus } from "../../ai/ai-types";
import { unwrap } from "../ipc";

const COMPACT_KEY = "pve-console.ai-usage.compact";

function remaining(reset?: string): string {
  if (!reset) return "window starts on first use";
  const milliseconds = Math.max(0, Date.parse(reset) - Date.now());
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.ceil((milliseconds % 3_600_000) / 60_000);
  return `resets in ${hours}h ${minutes}m`;
}

export function AiUsageIndicator(): JSX.Element | null {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [compact, setCompact] = useState(() => localStorage.getItem(COMPACT_KEY) === "true");
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
  const detail = `${provider} · ${status.localUsage.requests} used · ${remaining(status.localUsage.resetsAt)}`;
  const toggle = () => {
    setCompact((current) => {
      localStorage.setItem(COMPACT_KEY, String(!current));
      return !current;
    });
  };

  return (
    <button
      className={`ai-usage-indicator ${status.configured ? "ready" : ""} ${compact ? "compact" : ""}`}
      title={`${detail}. Subscription via official CLI; local PVE Console requests only, not authoritative account allowance. Click to ${compact ? "expand" : "minimize"}.`}
      aria-label={`AI usage: ${detail}. ${compact ? "Expand" : "Minimize"}`}
      aria-expanded={!compact}
      onClick={toggle}
    >
      <span className="ai-pulse">⌁</span>
      {compact ? (
        <span>{status.localUsage.requests}</span>
      ) : (
        <>
          <span>{provider}</span>
          <span>{status.localUsage.requests} used</span>
          <span className="ai-reset">{remaining(status.localUsage.resetsAt)}</span>
          <span className="ai-minimize" aria-hidden="true">−</span>
        </>
      )}
    </button>
  );
}
