import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ServerProfile } from "../profiles/profile-types";
import type { AppSettings, ServerStatus } from "../shared/types";
import type {
  SshConnectionStatus,
  SshHostKeyDecision,
  SshHostKeyPrompt,
  SshProfile,
} from "../ssh/ssh-types";
import type { NavigationState } from "../main/webcontents-manager";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { AppShell } from "./components/AppShell";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { CertificateDialog } from "./components/CertificateDialog";
import { SshHostKeyDialog } from "./components/SshHostKeyDialog";
import { AiUsageIndicator } from "./components/AiUsageIndicator";
import { Home } from "./pages/Home";
import { AddServer } from "./pages/AddServer";
import { EditServer } from "./pages/EditServer";
import { Diagnostics } from "./pages/Diagnostics";
import { Settings } from "./pages/Settings";
import { ServerWorkspace } from "./pages/ServerWorkspace";
import { unwrap } from "./ipc";
import type { CertificatePromptPayload, Route, StatusMap } from "./types";

const TerminalWorkspace = lazy(() =>
  import("./pages/TerminalWorkspace").then((module) => ({
    default: module.TerminalWorkspace,
  })),
);

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
  const [terminalProfiles, setTerminalProfiles] = useState<SshProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [terminalStatuses, setTerminalStatuses] = useState<Record<string, SshConnectionStatus>>({});
  const [openTerminals, setOpenTerminals] = useState<string[]>([]);
  const [newTerminalProfileId, setNewTerminalProfileId] = useState<string | null>(null);
  const [navByServer, setNavByServer] = useState<Record<string, NavigationState>>({});
  const [crashByServer, setCrashByServer] = useState<Record<string, string>>({});
  const [loadErrorByServer, setLoadErrorByServer] = useState<Record<string, string>>({});
  const [certPrompt, setCertPrompt] = useState<CertificatePromptPayload | null>(null);
  const [sshHostPrompt, setSshHostPrompt] = useState<SshHostKeyPrompt | null>(null);
  const autoConnected = useRef(false);

  const setStatus = useCallback((id: string, status: ServerStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const refreshProfiles = useCallback(async () => {
    const list = await unwrap(window.pve.profiles.list());
    setProfiles(list);
    return list;
  }, []);

  const refreshTerminalProfiles = useCallback(async () => {
    const list = await unwrap(window.pve.terminalProfiles.list());
    setTerminalProfiles(list);
    return list;
  }, []);

  // Initial load.
  useEffect(() => {
    void (async () => {
      const [list, sshList, loaded] = await Promise.all([
        unwrap(window.pve.profiles.list()),
        unwrap(window.pve.terminalProfiles.list()),
        unwrap(window.pve.settings.get()),
      ]);
      setProfiles(list);
      setTerminalProfiles(sshList);
      setSettings(loaded);
      applyTheme(loaded.theme);
    })();
  }, []);

  // Event subscriptions.
  useEffect(() => {
    const offNav = window.pve.on("server:navigation", (payload) => {
      const { profileId, state } = payload as { profileId: string; state: NavigationState };
      setNavByServer((prev) => ({ ...prev, [profileId]: state }));
    });
    const offLoaded = window.pve.on("server:loaded", (payload) => {
      const { profileId } = payload as { profileId: string };
      setStatus(profileId, "connected");
      // A successful (re)load clears any prior failure/crash overlay.
      setLoadErrorByServer((prev) => ({ ...prev, [profileId]: "" }));
      setCrashByServer((prev) => ({ ...prev, [profileId]: "" }));
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
    const offTerminalStatus = window.pve.on("terminal:status", (payload) => {
      const { profileId, status } = payload as {
        profileId: string;
        status: SshConnectionStatus;
      };
      setTerminalStatuses((previous) => ({ ...previous, [profileId]: status }));
    });
    const offSshHost = window.pve.on("sshHost:prompt", (payload) => {
      setSshHostPrompt(payload as SshHostKeyPrompt);
    });
    return () => {
      offNav();
      offLoaded();
      offStatus();
      offCrash();
      offLoad();
      offCert();
      offTerminalStatus();
      offSshHost();
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
  const activeTerminal =
    route.name === "terminal"
      ? terminalProfiles.find((profile) => profile.id === route.profileId) ?? null
      : null;

  const openTerminal = useCallback((id: string) => {
    if (id !== newTerminalProfileId) {
      setOpenTerminals((current) => current.includes(id) ? current : [...current, id]);
    }
    setRoute({ name: "terminal", profileId: id });
  }, [newTerminalProfileId]);

  const openNewTerminal = useCallback(() => {
    setOpenTerminals((current) => current.includes("new") ? current : [...current, "new"]);
    setRoute({ name: "terminal-new" });
  }, []);

  const handleCertDecision = async (
    decision: "cancel" | "trust-once" | "trust-and-pin" | "replace-pin",
  ) => {
    if (!certPrompt) return;
    await unwrap(window.pve.certificate.respond(certPrompt.requestId, decision));
    setCertPrompt(null);
  };

  const handleSshHostDecision = async (decision: SshHostKeyDecision) => {
    if (!sshHostPrompt) return;
    await unwrap(window.pve.terminal.respondToHostKey(sshHostPrompt.requestId, decision));
    setSshHostPrompt(null);
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
      case "terminal-new":
        return null;
      case "terminal":
        return activeTerminal ? null : (
          <div className="page"><div className="empty">SSH connection not found.</div></div>
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
            onOpenSettings={() => setRoute({ name: "settings" })}
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
            activeTerminal={activeTerminal}
            activeTerminalLabel={route.name === "terminal-new" ? "New SSH terminal" : undefined}
            terminalStatus={
              activeTerminal ? (terminalStatuses[activeTerminal.id] ?? "disconnected") : null
            }
          />
        }
        sidebar={
          <Sidebar
            profiles={profiles}
            statuses={statuses}
            terminalProfiles={terminalProfiles}
            terminalStatuses={terminalStatuses}
            route={route}
            activeServerId={activeServerId}
            onSelectServer={openServer}
            onSelectTerminal={openTerminal}
            onNavigate={(nextRoute) => {
              if (nextRoute.name === "terminal-new") openNewTerminal();
              else setRoute(nextRoute);
            }}
          />
        }
      >
        {renderMain()}
        {openTerminals.map((terminalId) => {
          const isNew = terminalId === "new";
          const profileId = isNew ? newTerminalProfileId : terminalId;
          const savedProfile = !isNew && profileId
            ? terminalProfiles.find((profile) => profile.id === profileId) ?? null
            : null;
          if (!isNew && !savedProfile) return null;
          const isActive = isNew
            ? route.name === "terminal-new" ||
              (route.name === "terminal" && route.profileId === newTerminalProfileId)
            : route.name === "terminal" && route.profileId === terminalId;
          return (
            <div
              key={terminalId}
              className={`persistent-terminal ${isActive ? "active" : ""}`}
              aria-hidden={!isActive}
            >
              <Suspense fallback={<div className="empty">Loading terminal...</div>}>
                <TerminalWorkspace
                  profile={savedProfile}
                  active={isActive}
                  onProfilesChanged={async () => {
                    await refreshTerminalProfiles();
                  }}
                  onProfileCreated={isNew ? (createdProfile) => {
                    setNewTerminalProfileId(createdProfile.id);
                    setRoute({ name: "terminal", profileId: createdProfile.id });
                  } : undefined}
                  onDeleted={profileId ? async () => {
                    setOpenTerminals((current) => current.filter((id) => id !== terminalId));
                    if (isNew) setNewTerminalProfileId(null);
                    await refreshTerminalProfiles();
                    setRoute({ name: "home" });
                  } : undefined}
                />
              </Suspense>
            </div>
          );
        })}
      </AppShell>

      <AiUsageIndicator />
      {certPrompt && <CertificateDialog prompt={certPrompt} onDecide={handleCertDecision} />}
      {sshHostPrompt && (
        <SshHostKeyDialog prompt={sshHostPrompt} onDecide={handleSshHostDecision} />
      )}
    </>
  );
}
