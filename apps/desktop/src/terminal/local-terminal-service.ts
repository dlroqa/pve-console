import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import type {
  StartLocalTerminalInput,
  TerminalDirectoryListing,
  TerminalSessionResult,
} from "./terminal-types";
import { SshError } from "../ssh/ssh-error";

type Emit = (channel: string, payload: unknown) => void;

interface LocalSession {
  targetId: string;
  process: pty.IPty;
}

function terminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  return {
    cols: Math.max(20, Math.min(500, Math.floor(Number(cols) || 80))),
    rows: Math.max(5, Math.min(300, Math.floor(Number(rows) || 24))),
  };
}

function shellCommand(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "powershell.exe", args: [] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

export class LocalTerminalService {
  private readonly sessions = new Map<string, LocalSession>();

  constructor(private readonly emit: Emit) {}

  start(input: StartLocalTerminalInput): TerminalSessionResult {
    const targetId = String(input.targetId || "").trim();
    if (!targetId || targetId.length > 80) throw new SshError("Invalid terminal id.");
    const sessionId = randomUUID();
    const size = terminalSize(input.cols, input.rows);
    const shell = shellCommand();
    const cwd = homedir();
    const child = pty.spawn(shell.file, shell.args, {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        PROMPT_COMMAND: "printf '\\033]7;file://%s%s\\007' \"$HOSTNAME\" \"$PWD\"",
      } as Record<string, string>,
    });
    this.sessions.set(sessionId, { targetId, process: child });
    child.onData((data) => this.emit("terminal:data", { sessionId, data }));
    child.onExit(({ exitCode }) => {
      this.sessions.delete(sessionId);
      this.emit("terminal:status", {
        profileId: targetId,
        sessionId,
        status: "disconnected",
        message: exitCode === 0 ? undefined : `Local shell exited with code ${exitCode}.`,
      });
    });
    this.emit("terminal:status", { profileId: targetId, sessionId, status: "connected" });
    return { sessionId, targetId, location: "local" };
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  write(sessionId: string, data: string): void {
    if (typeof data !== "string" || data.length > 64 * 1024) throw new SshError("Invalid terminal input.");
    const session = this.sessions.get(sessionId);
    if (!session) throw new SshError("Local terminal session is not running.");
    session.process.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const size = terminalSize(cols, rows);
    session.process.resize(size.cols, size.rows);
  }

  disconnect(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.process.kill();
    this.emit("terminal:status", { profileId: session.targetId, sessionId, status: "disconnected" });
  }

  disconnectAll(): void {
    for (const sessionId of [...this.sessions.keys()]) this.disconnect(sessionId);
  }

  async listDirectory(path?: string): Promise<TerminalDirectoryListing> {
    const resolved = normalize(path || homedir());
    const entries = await readdir(resolved, { withFileTypes: true });
    return {
      path: resolved,
      parentPath: dirname(resolved) === resolved ? undefined : dirname(resolved),
      entries: entries
        .map((entry) => ({
          name: entry.name,
          path: join(resolved, entry.name),
          kind: entry.isDirectory() ? "directory" as const : entry.isSymbolicLink() ? "link" as const : "file" as const,
          hidden: entry.name.startsWith("."),
        }))
        .sort((left, right) => {
          if (left.kind === "directory" && right.kind !== "directory") return -1;
          if (left.kind !== "directory" && right.kind === "directory") return 1;
          return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        }),
    };
  }
}
