import type { NavigationState } from "../../main/webcontents-manager";

interface Props {
  nav: NavigationState | null;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onReconnect: () => void;
  onOpenProxmox: () => void;
  onNativePage: () => void;
  onDiagnostics: () => void;
}

/** Browser-style controls for the server workspace (spec §11.3, §6.6). */
export function NavigationControls({
  nav,
  onBack,
  onForward,
  onReload,
  onReconnect,
  onOpenProxmox,
  onNativePage,
  onDiagnostics,
}: Props): JSX.Element {
  return (
    <div className="controls">
      <button className="ghost" onClick={onBack} disabled={!nav?.canGoBack} title="Back">
        ←
      </button>
      <button className="ghost" onClick={onForward} disabled={!nav?.canGoForward} title="Forward">
        →
      </button>
      <button className="ghost" onClick={onReload} title="Reload">
        ⟳
      </button>
      <span className="url">{nav?.url ?? ""}</span>
      <button className="ghost" onClick={onReconnect}>
        Reconnect
      </button>
      <button className="ghost" onClick={onOpenProxmox}>
        Open Proxmox
      </button>
      <button className="ghost" onClick={onNativePage}>
        Native
      </button>
      <button className="ghost" onClick={onDiagnostics}>
        Diagnostics
      </button>
    </div>
  );
}
