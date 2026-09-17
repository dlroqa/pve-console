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

interface OpenTerminal {
  id: string;
  label: string;
  profileId?: string;
}

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
  const [openTerminals, setOpenTerminals] = useState<OpenTerminal[]>([]);
  const terminalNumber = useRef(0);
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
  const activeTerminalSession = route.name === "terminal-session"
    ? openTerminals.find((terminal) => terminal.id === route.terminalId) ?? null
    : null;
  const activeTerminal = activeTerminalSession?.profileId
    ? terminalProfiles.find((profile) => profile.id === activeTerminalSession.profileId) ?? null
    : null;

  const openTerminal = useCallback((profileId: string) => {
    const existing = openTerminals.find((terminal) => terminal.profileId === profileId);
    if (existing) {
      setRoute({ name: "terminal-session", terminalId: existing.id });
      return;
    }
    const profile = terminalProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    const id = window.crypto.randomUUID();
    setOpenTerminals((current) => [...current, { id, profileId, label: profile.name }]);
    setRoute({ name: "terminal-session", terminalId: id });
  }, [openTerminals, terminalProfiles]);

  const openNewTerminal = useCallback(() => {
    terminalNumber.current += 1;
    const terminal: OpenTerminal = {
      id: window.crypto.randomUUID(),
      label: `Terminal ${terminalNumber.current}`,
    };
    setOpenTerminals((current) => [...current, terminal]);
    setRoute({ name: "terminal-session", terminalId: terminal.id });
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
      case "terminal-session":
        return activeTerminalSession ? null : (
          <div className="page"><div className="empty">Terminal session not found.</div></div>
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
            activeTerminalLabel={activeTerminalSession?.label}
            terminalStatus={
              activeTerminalSession
                ? (terminalStatuses[activeTerminalSession.profileId ?? activeTerminalSession.id] ?? "disconnected")
                : null
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
            openTerminals={openTerminals.map((terminal) => {
              const profile = terminal.profileId
                ? terminalProfiles.find((item) => item.id === terminal.profileId)
                : undefined;
              return {
                id: terminal.id,
                label: profile?.name ?? terminal.label,
                profileId: terminal.profileId,
                address: profile
                  ? `${profile.username}@${profile.host}:${profile.port}`
                  : undefined,
                status: terminalStatuses[terminal.profileId ?? terminal.id] ?? "disconnected",
              };
            })}
            onSelectTerminal={openTerminal}
            onSelectOpenTerminal={(id) => setRoute({ name: "terminal-session", terminalId: id })}
            onNavigate={(nextRoute) => {
              if (nextRoute.name === "terminal-session" && nextRoute.terminalId === "new") {
                openNewTerminal();
              } else {
                setRoute(nextRoute);
              }
            }}
          />
        }
      >
        {renderMain()}
        {openTerminals.map((terminal) => {
          const savedProfile = terminal.profileId
            ? terminalProfiles.find((profile) => profile.id === terminal.profileId) ?? null
            : null;
          const isActive = route.name === "terminal-session" && route.terminalId === terminal.id;
          const closeTerminal = () => {
            setOpenTerminals((current) => current.filter((item) => item.id !== terminal.id));
            if (isActive) setRoute({ name: "home" });
          };
          return (
            <div
              key={terminal.id}
              className={`persistent-terminal ${isActive ? "active" : ""}`}
              aria-hidden={!isActive}
            >
              <Suspense fallback={<div className="empty">Loading terminal...</div>}>
                <TerminalWorkspace
                  profile={savedProfile}
                  targetId={terminal.id}
                  active={isActive}
                  onClose={closeTerminal}
                  onProfilesChanged={async () => {
                    await refreshTerminalProfiles();
                  }}
                  onProfileCreated={(createdProfile) => {
                    setOpenTerminals((current) => current.map((item) =>
                      item.id === terminal.id
                        ? { ...item, profileId: createdProfile.id, label: createdProfile.name }
                        : item,
                    ));
                  }}
                  onDeleted={savedProfile ? async () => {
                    closeTerminal();
                    await refreshTerminalProfiles();
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
