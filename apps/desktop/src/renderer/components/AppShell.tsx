import type { ReactNode } from "react";

interface Props {
  topbar: ReactNode;
  sidebar: ReactNode;
  sidebarOpen: boolean;
  children: ReactNode;
}

/** The native application shell layout (spec §10): topbar, sidebar, main. */
export function AppShell({ topbar, sidebar, sidebarOpen, children }: Props): JSX.Element {
  return (
    <div className={"shell" + (sidebarOpen ? "" : " sidebar-collapsed")}>
      {topbar}
      {sidebarOpen && sidebar}
      <main className="main">{children}</main>
    </div>
  );
}
