import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ServerProfile } from "../../profiles/profile-types";
import type { NavigationState } from "../../main/webcontents-manager";
import type { ServerStatus } from "../../shared/types";
import { NavigationControls } from "../components/NavigationControls";
import { unwrap, errorMessage } from "../ipc";

type Mode = "proxmox" | "native";

interface Props {
  profile: ServerProfile;
  status: ServerStatus;
  nav: NavigationState | null;
  crashReason: string | null;
  loadError: string | null;
  onOpenDiagnostics: () => void;
  onClearError: () => void;
}

export function ServerWorkspace({
  profile,
  status,
  nav,
  crashReason,
  loadError,
  onOpenDiagnostics,
  onClearError,
}: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>("proxmox");
  const [actionError, setActionError] = useState<string | null>(null);
  const regionRef = useRef<HTMLDivElement>(null);

  const reportBounds = useCallback(() => {
    const el = regionRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void window.pve.server.setContentBounds({
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });
  }, []);

  // Connect / detach the embedded view as the mode or server changes.
  useEffect(() => {
    let cancelled = false;
    if (mode === "proxmox") {
      onClearError();
      unwrap(window.pve.server.connect(profile.id))
        .then(() => {
          if (!cancelled) reportBounds();
        })
        .catch((e) => !cancelled && setActionError(errorMessage(e)));
    } else {
      void window.pve.server.showNative();
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, profile.id]);

  // Keep the embedded view aligned to the content region on resize.
  useLayoutEffect(() => {
    if (mode !== "proxmox") return;
    reportBounds();
    const ro = new ResizeObserver(() => reportBounds());
    if (regionRef.current) ro.observe(regionRef.current);
    window.addEventListener("resize", reportBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", reportBounds);
    };
  }, [mode, reportBounds]);

  // Detach the overlay when leaving the workspace entirely.
  useEffect(() => {
    return () => {
      void window.pve.server.showNative();
    };
  }, []);

  const controlAction = (fn: () => Promise<unknown>) => () => {
    fn().catch((e) => setActionError(errorMessage(e)));
  };

  return (
    <div className="workspace">
      <NavigationControls
        nav={mode === "proxmox" ? nav : null}
        onBack={controlAction(() => window.pve.server.back())}
        onForward={controlAction(() => window.pve.server.forward())}
        onReload={controlAction(() => window.pve.server.reload())}
        onReconnect={controlAction(async () => {
          onClearError();
          setMode("proxmox");
          await window.pve.server.reconnect(profile.id);
        })}
        onOpenProxmox={() => setMode("proxmox")}
        onNativePage={() => setMode("native")}
        onDiagnostics={onOpenDiagnostics}
      />

      {mode === "proxmox" ? (
        <div className="content-region" ref={regionRef}>
          {(crashReason || loadError || actionError) && (
            <div className="overlay-msg">
              {crashReason && (
                <>
                  <div style={{ fontSize: 16 }}>The Proxmox view crashed ({crashReason}).</div>
                  <div style={{ color: "var(--text-faint)" }}>
                    Your server profile and certificate pin are preserved.
                  </div>
                </>
              )}
              {loadError && <div>Could not load the server: {loadError}</div>}
              {actionError && <div className="banner error">{actionError}</div>}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="primary"
                  onClick={controlAction(async () => {
                    onClearError();
                    setActionError(null);
                    await window.pve.server.reconnect(profile.id);
                  })}
                >
                  Retry
                </button>
                <button onClick={onOpenDiagnostics}>Diagnostics</button>
              </div>
            </div>
          )}
          {!crashReason && !loadError && (
            <div className="overlay-msg" style={{ pointerEvents: "none" }}>
              Loading {profile.name}…
            </div>
          )}
        </div>
      ) : (
        <NativeServerPage profile={profile} status={status} onOpenProxmox={() => setMode("proxmox")} />
      )}
    </div>
  );
}

/** Native Server Page (spec §35). Static info only — no API calls in V1. */
function NativeServerPage({
  profile,
  status,
  onOpenProxmox,
}: {
  profile: ServerProfile;
  status: ServerStatus;
  onOpenProxmox: () => void;
}): JSX.Element {
  return (
    <div className="page">
      <h1>{profile.name}</h1>
      <p className="subtitle">
        {profile.host}:{profile.port}
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="kv-table">
          <span className="k">Status</span>
          <span className="v">{status}</span>
          <span className="k">Protocol</span>
          <span className="v">{profile.protocol}</span>
          <span className="k">Connection</span>
          <span className="v">{profile.connectionMode}</span>
          <span className="k">Certificate</span>
          <span className="v">
            {profile.certificateMode}
            {profile.pinnedFingerprint ? " (pinned)" : ""}
          </span>
        </div>
        <div style={{ marginTop: 16 }}>
          <button className="primary" onClick={onOpenProxmox}>
            Open Proxmox
          </button>
        </div>
      </div>
      <div className="banner info" style={{ marginTop: 20 }}>
        Native dashboards and metrics arrive in a later version. The full Proxmox web interface is
        always available via “Open Proxmox”.
      </div>
    </div>
  );
}
