import { Fragment, useCallback, useEffect, useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { DashboardData, ApiTokenStatus } from "../../proxmox/proxmox-types";
import { unwrap, errorMessage } from "../ipc";
import { TokenConfig } from "./TokenConfig";

interface Props {
  profile: ServerProfile;
  onOpenProxmox: () => void;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function UsageBar({ label, fraction }: { label: string; fraction: number }): JSX.Element {
  const clamped = Math.max(0, Math.min(1, fraction));
  return (
    <div className="usage">
      <div className="usage-head">
        <span>{label}</span>
        <span>{pct(clamped)}</span>
      </div>
      <div className="usage-track">
        <div className="usage-fill" style={{ width: pct(clamped) }} />
      </div>
    </div>
  );
}

/** Native dashboard (spec §10, Phase 10). Read-only; the embedded Proxmox UI stays available. */
export function NativeDashboard({ profile, onOpenProxmox }: Props): JSX.Element {
  const [tokenStatus, setTokenStatus] = useState<ApiTokenStatus | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    const status = await unwrap(window.pve.proxmox.getTokenStatus(profile.id));
    setTokenStatus(status);
    return status;
  }, [profile.id]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = await unwrap(window.pve.proxmox.getSummary(profile.id));
      setData(summary);
    } catch (e) {
      // API errors must not break the app; surface them and keep browser mode.
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [profile.id]);

  useEffect(() => {
    setData(null);
    setError(null);
    void (async () => {
      const status = await loadStatus();
      if (status.configured) await loadData();
    })();
  }, [profile.id, loadStatus, loadData]);

  if (tokenStatus && !tokenStatus.configured) {
    return (
      <div className="page">
        <h1>{profile.name} · Dashboard</h1>
        <p className="subtitle">
          Add a restricted Proxmox API token to enable native metrics. The embedded Proxmox UI works
          without it.
        </p>
        <TokenConfig
          profile={profile}
          onConfigured={async () => {
            await loadStatus();
            await loadData();
          }}
        />
        <div style={{ marginTop: 18 }}>
          <button onClick={onOpenProxmox}>Open Proxmox</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page dashboard">
      <div className="dash-head">
        <div>
          <h1>{profile.name}</h1>
          <p className="subtitle">
            {profile.host}:{profile.port}
            {tokenStatus?.tokenName ? ` · token ${tokenStatus.tokenName}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={loadData} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button className="primary" onClick={onOpenProxmox}>
            Open Proxmox
          </button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {data && (
        <>
          <div className="stat-row">
            <Stat label="Nodes" value={data.cluster.nodes} />
            <Stat label="VMs" value={data.cluster.vms} />
            <Stat label="LXC" value={data.cluster.lxc} />
            <Stat label="Running" value={data.cluster.running} accent="ok" />
            <Stat label="Stopped" value={data.cluster.stopped} />
          </div>

          <div className="card" style={{ maxWidth: 620, marginTop: 18 }}>
            <UsageBar label="CPU" fraction={data.cpuUsage} />
            <UsageBar label="RAM" fraction={data.memUsage} />
            <UsageBar label="Storage" fraction={data.storageUsage} />
          </div>

          <h2 style={{ fontSize: 16, marginTop: 26 }}>Guests</h2>
          {data.guests.length === 0 ? (
            <div className="empty" style={{ textAlign: "left", padding: "10px 0" }}>
              No VMs or containers reported.
            </div>
          ) : (
            <div className="diag-list" style={{ maxWidth: 620 }}>
              {data.guests
                .slice()
                .sort((a, b) => a.vmid - b.vmid)
                .map((g) => (
                  <div className="diag-row" key={`${g.type}-${g.vmid}`}>
                    <span className="label" style={{ width: 60 }}>
                      {g.vmid}
                    </span>
                    <span className="msg">
                      {g.name}
                      <span style={{ color: "var(--text-faint)" }}> · {g.type}</span>
                    </span>
                    <span className={`status`}>
                      <span className={`dot ${g.status === "running" ? "connected" : "offline"}`} />
                      {g.status}
                    </span>
                  </div>
                ))}
            </div>
          )}

          <h2 style={{ fontSize: 16, marginTop: 26 }}>Storage</h2>
          <div className="kv-table" style={{ maxWidth: 620 }}>
            {data.storage.map((s) => (
              <Fragment key={`${s.node}-${s.storage}`}>
                <span className="k">
                  {s.storage} ({s.node})
                </span>
                <span className="v">
                  {formatBytes(s.used ?? 0)} / {formatBytes(s.total ?? 0)}
                </span>
              </Fragment>
            ))}
          </div>
        </>
      )}

      {!data && !error && <div className="empty">Loading native metrics…</div>}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "ok";
}): JSX.Element {
  return (
    <div className="stat">
      <div className={`stat-value ${accent ?? ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
