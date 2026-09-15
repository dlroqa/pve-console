import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerProfile } from "../profiles/profile-types";
import type { AppSettings, ServerStatus } from "../shared/types";
import type { NavigationState } from "../main/webcontents-manager";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { AppShell } from "./components/AppShell";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { CertificateDialog } from "./components/CertificateDialog";
import { Home } from "./pages/Home";
import { AddServer } from "./pages/AddServer";
import { EditServer } from "./pages/EditServer";
import { Diagnostics } from "./pages/Diagnostics";
import { Settings } from "./pages/Settings";
import { ServerWorkspace } from "./pages/ServerWorkspace";
import { unwrap } from "./ipc";
import type { CertificatePromptPayload, Route, StatusMap } from "./types";

function applyTheme(theme: AppSettings["theme"]): void {
  const root = document.documentElement;
  const useLight =
    theme === "light" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  if (useLight) root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function App(): JSX.Element {
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [navByServer, setNavByServer] = useState<Record<string, NavigationState>>({});
  const [crashByServer, setCrashByServer] = useState<Record<string, string>>({});
  const [loadErrorByServer, setLoadErrorByServer] = useState<Record<string, string>>({});
  const [certPrompt, setCertPrompt] = useState<CertificatePromptPayload | null>(null);
  const autoConnected = useRef(false);

  const setStatus = useCallback((id: string, status: ServerStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const refreshProfiles = useCallback(async () => {
    const list = await unwrap(window.pve.profiles.list());
    setProfiles(list);
    return list;
  }, []);

  // Initial load.
  useEffect(() => {
    void (async () => {
      const [list, loaded] = await Promise.all([
        unwrap(window.pve.profiles.list()),
        unwrap(window.pve.settings.get()),
      ]);
      setProfiles(list);
      setSettings(loaded);
      applyTheme(loaded.theme);
    })();
  }, []);

  // Event subscriptions.
  useEffect(() => {
    const offNav = window.pve.on("server:navigation", (payload) => {
      const { profileId, state } = payload as { profileId: string; state: NavigationState };
      setNavByServer((prev) => ({ ...prev, [profileId]: state }));
      if (state.url && !state.isLoading) setStatus(profileId, "connected");
      else setStatus(profileId, "connecting");
    });
    const offStatus = window.pve.on("server:status", (payload) => {
      const { profileId, status } = payload as { profileId: string; status: ServerStatus };
      setStatus(profileId, status);
    });
    const offCrash = window.pve.on("server:crashed", (payload) => {
      const { profileId, reason } = payload as { profileId: string; reason: string };
      setCrashByServer((prev) => ({ ...prev, [profileId]: reason }));
      setStatus(profileId, "disconnected");
    });
    const offLoad = window.pve.on("server:load-error", (payload) => {
      const { profileId, message } = payload as { profileId: string; message: string };
      setLoadErrorByServer((prev) => ({ ...prev, [profileId]: message }));
      setStatus(profileId, "offline");
    });
    const offCert = window.pve.on("certificate:prompt", (payload) => {
      setCertPrompt(payload as CertificatePromptPayload);
    });
    return () => {
      offNav();
      offStatus();
      offCrash();
      offLoad();
      offCert();
    };
  }, [setStatus]);

  // Optional auto-connect (spec §8.4).
  useEffect(() => {
    if (autoConnected.current || profiles.length === 0) return;
    const auto = profiles.find((p) => p.autoConnect);
    if (auto) {
      autoConnected.current = true;
      openServer(auto.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const openServer = (id: string) => {
    setCrashByServer((prev) => ({ ...prev, [id]: "" }));
    setLoadErrorByServer((prev) => ({ ...prev, [id]: "" }));
    setStatus(id, "connecting");
    setRoute({ name: "workspace", serverId: id });
  };

  const clearActiveError = useCallback(
    (id: string) => {
      setCrashByServer((prev) => ({ ...prev, [id]: "" }));
      setLoadErrorByServer((prev) => ({ ...prev, [id]: "" }));
    },
    [],
  );

  const activeServerId =
    route.name === "workspace"
      ? route.serverId
      : route.name === "edit"
        ? route.serverId
        : null;
  const activeProfile = profiles.find((p) => p.id === activeServerId) ?? null;

  const handleCertDecision = async (
    decision: "cancel" | "trust-once" | "trust-and-pin" | "replace-pin",
  ) => {
    if (!certPrompt) return;
    await unwrap(window.pve.certificate.respond(certPrompt.requestId, decision));
    setCertPrompt(null);
  };

  const renderMain = () => {
    switch (route.name) {
      case "home":
        return (
          <Home
            profiles={profiles}
            statuses={statuses}
            onOpen={openServer}
            onEdit={(id) => setRoute({ name: "edit", serverId: id })}
            onAdd={() => setRoute({ name: "add" })}
          />
        );
      case "add":
        return (
          <AddServer
            onSaved={async () => {
              await refreshProfiles();
              setRoute({ name: "home" });
            }}
            onCancel={() => setRoute({ name: "home" })}
          />
        );
      case "edit":
        return (
          <EditServer
            serverId={route.serverId}
            onSaved={async () => {
              await refreshProfiles();
              setRoute({ name: "home" });
            }}
            onDeleted={async () => {
              await refreshProfiles();
              setRoute({ name: "home" });
            }}
            onCancel={() => setRoute({ name: "home" })}
          />
        );
      case "diagnostics":
        return <Diagnostics profiles={profiles} initialServerId={route.serverId} />;
      case "settings":
        return (
          <Settings
            settings={settings}
            profiles={profiles}
            onSettingsChange={(s) => {
              setSettings(s);
              applyTheme(s.theme);
            }}
          />
        );
      case "workspace": {
        if (!activeProfile) {
          return <div className="page"><div className="empty">Server not found.</div></div>;
        }
        return (
          <ServerWorkspace
            profile={activeProfile}
            nav={navByServer[activeProfile.id] ?? null}
            crashReason={crashByServer[activeProfile.id] || null}
            loadError={loadErrorByServer[activeProfile.id] || null}
            onOpenDiagnostics={() =>
              setRoute({ name: "diagnostics", serverId: activeProfile.id })
            }
            onClearError={() => clearActiveError(activeProfile.id)}
          />
        );
      }
      default:
        return null;
    }
  };

  return (
    <>
      <AppShell
        topbar={
          <Topbar
            activeProfile={route.name === "workspace" ? activeProfile : null}
            status={activeProfile ? (statuses[activeProfile.id] ?? "disconnected") : null}
          />
        }
        sidebar={
          <Sidebar
            profiles={profiles}
            statuses={statuses}
            route={route}
            activeServerId={activeServerId}
            onSelectServer={openServer}
            onNavigate={setRoute}
          />
        }
      >
        {renderMain()}
      </AppShell>

      {certPrompt && <CertificateDialog prompt={certPrompt} onDecide={handleCertDecision} />}
    </>
  );
}
