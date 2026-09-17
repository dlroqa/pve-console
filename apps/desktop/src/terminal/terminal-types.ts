export type TerminalLocation = "local" | "remote";

export interface TerminalSessionResult {
  sessionId: string;
  targetId: string;
  location: TerminalLocation;
}

export interface TerminalDirectoryEntry {
  name: string;
  path: string;
  kind: "directory" | "file" | "link";
  hidden: boolean;
}

export interface TerminalDirectoryListing {
  path: string;
  parentPath?: string;
  entries: TerminalDirectoryEntry[];
}

export interface StartLocalTerminalInput {
  targetId: string;
  cols: number;
  rows: number;
}
