import { Fragment, useCallback, useEffect, useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { DashboardData, ApiTokenStatus, GuestSummary } from "../../proxmox/proxmox-types";
import { unwrap, errorMessage } from "../ipc";
import { TokenConfig } from "./TokenConfig";
import { ConfirmDialog } from "./ConfirmDialog";

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

type ConfirmKind = "shutdown" | "reboot" | "stop";
type GuestT = "qemu" | "lxc";

/** Native dashboard + VM/LXC controls (spec §10, §11). The embedded Proxmox UI stays available. */
export function NativeDashboard({ profile, onOpenProxmox }: Props): JSX.Element {
  const [tokenStatus, setTokenStatus] = useState<ApiTokenStatus | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirm, setConfirm] = useState<{ guest: GuestSummary; kind: ConfirmKind } | null>(null);
  const [snapshotFor, setSnapshotFor] = useState<GuestSummary | null>(null);
  const [snapName, setSnapName] = useState("");

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

  /** Run a control action, then refresh after the task settles. */
  const runAction = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await fn();
      setActionNotice(`${label} requested.`);
      setConfirm(null);
      setSnapshotFor(null);
      setSnapName("");
      // Proxmox actions are asynchronous tasks; refresh shortly after.
      setTimeout(() => void loadData(), 1500);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const gt = (g: GuestSummary): GuestT => (g.type === "lxc" ? "lxc" : "qemu");

  if (tokenStatus && !tokenStatus.configured) {
    return (
      <div className="page">
        <h1>{profile.name} · Dashboard</h1>
        <p className="subtitle">
          Add a restricted Proxmox API token to enable native metrics and controls. The embedded
          Proxmox UI works without it.
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
      {actionError && <div className="banner error">{actionError}</div>}
      {actionNotice && <div className="banner info">{actionNotice}</div>}

      {data && (
        <>
          <div className="stat-row">
            <Stat label="Nodes" value={data.cluster.nodes} />
            <Stat label="VMs" value={data.cluster.vms} />
            <Stat label="LXC" value={data.cluster.lxc} />
            <Stat label="Running" value={data.cluster.running} accent="ok" />
            <Stat label="Stopped" value={data.cluster.stopped} />
          </div>

          <div className="card" style={{ maxWidth: 680, marginTop: 18 }}>
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
            <div className="guest-list">
              {data.guests
                .slice()
                .sort((a, b) => a.vmid - b.vmid)
                .map((g) => {
                  const running = g.status === "running";
                  return (
                    <div className="guest-row" key={`${g.type}-${g.vmid}`}>
                      <span className="vmid">{g.vmid}</span>
                      <span className="gname">
                        {g.name}
                        <span style={{ color: "var(--text-faint)" }}> · {g.type}</span>
                      </span>
                      <span className="status">
                        <span className={`dot ${running ? "connected" : "offline"}`} />
                        {g.status}
                      </span>
                      <span className="guest-actions">
                        {!running && (
                          <button
                            className="ghost"
                            disabled={busy}
                            onClick={() =>
                              runAction(`Start ${g.vmid}`, () =>
                                unwrap(window.pve.proxmox.startGuest(profile.id, g.node, gt(g), g.vmid)),
                              )
                            }
                          >
                            Start
                          </button>
                        )}
                        {running && (
                          <>
                            <button
                              className="ghost"
                              disabled={busy}
                              onClick={() => setConfirm({ guest: g, kind: "shutdown" })}
                            >
                              Shutdown
                            </button>
                            <button
                              className="ghost"
                              disabled={busy}
                              onClick={() => setConfirm({ guest: g, kind: "reboot" })}
                            >
                              Reboot
                            </button>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => setConfirm({ guest: g, kind: "stop" })}
                            >
                              Stop
                            </button>
                          </>
                        )}
                        <button
                          className="ghost"
                          disabled={busy}
                          onClick={() => {
                            setSnapName("");
                            setSnapshotFor(g);
                          }}
                        >
                          Snapshot
                        </button>
                        <button className="ghost" onClick={onOpenProxmox} title="Open in Proxmox">
                          Open
                        </button>
                      </span>
                    </div>
                  );
                })}
            </div>
          )}

          <h2 style={{ fontSize: 16, marginTop: 26 }}>Storage</h2>
          <div className="kv-table" style={{ maxWidth: 680 }}>
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

      {confirm && (
        <ConfirmDialog
          title={confirmTitle(confirm.kind, confirm.guest)}
          message={confirmMessage(confirm.kind, confirm.guest)}
          confirmLabel={confirmLabel(confirm.kind)}
          danger={confirm.kind === "stop"}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const g = confirm.guest;
            const t = gt(g);
            if (confirm.kind === "stop") {
              void runAction(`Stop ${g.vmid}`, () =>
                unwrap(window.pve.proxmox.stopGuest(profile.id, g.node, t, g.vmid)),
              );
            } else if (confirm.kind === "shutdown") {
              void runAction(`Shutdown ${g.vmid}`, () =>
                unwrap(window.pve.proxmox.shutdownGuest(profile.id, g.node, t, g.vmid)),
              );
            } else {
              void runAction(`Reboot ${g.vmid}`, () =>
                unwrap(window.pve.proxmox.rebootGuest(profile.id, g.node, t, g.vmid)),
              );
            }
          }}
        />
      )}

      {snapshotFor && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <h2>
              Snapshot {snapshotFor.vmid} “{snapshotFor.name}”
            </h2>
            <div className="field">
              <label>Snapshot name</label>
              <input
                value={snapName}
                onChange={(e) => setSnapName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
                placeholder="e.g. before_update"
                autoFocus
              />
              <div className="hint">Letters, numbers and underscores only.</div>
            </div>
            <div className="actions">
              <button onClick={() => setSnapshotFor(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || snapName.length === 0}
                onClick={() => {
                  const g = snapshotFor;
                  void runAction(`Snapshot ${g.vmid}`, () =>
                    unwrap(
                      window.pve.proxmox.createSnapshot(profile.id, g.node, gt(g), g.vmid, snapName),
                    ),
                  );
                }}
              >
                {busy ? "Working…" : "Create Snapshot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function confirmTitle(kind: ConfirmKind, g: GuestSummary): string {
  const verb = kind === "stop" ? "Stop" : kind === "shutdown" ? "Shut down" : "Reboot";
  return `${verb} ${g.type.toUpperCase()} ${g.vmid}?`;
}

function confirmMessage(kind: ConfirmKind, g: GuestSummary): string {
  if (kind === "stop") {
    return `You are about to hard-stop ${g.vmid} "${g.name}". This may interrupt services and is not a graceful shutdown.`;
  }
  if (kind === "shutdown") {
    return `Gracefully shut down ${g.vmid} "${g.name}"? Running services will be stopped.`;
  }
  return `Reboot ${g.vmid} "${g.name}"? This will restart the guest and interrupt services.`;
}

function confirmLabel(kind: ConfirmKind): string {
  return kind === "stop" ? "Stop" : kind === "shutdown" ? "Shut Down" : "Reboot";
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
