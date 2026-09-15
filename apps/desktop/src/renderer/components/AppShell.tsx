import type { ReactNode } from "react";

interface Props {
  topbar: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}

/** The native application shell layout (spec §10): topbar, sidebar, main. */
export function AppShell({ topbar, sidebar, children }: Props): JSX.Element {
  return (
    <div className="shell">
      {topbar}
      {sidebar}
      <main className="main">{children}</main>
    </div>
  );
}
