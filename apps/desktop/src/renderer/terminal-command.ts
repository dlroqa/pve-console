export interface ParsedSshTarget {
  username: string;
  host: string;
  port: number;
}

export function parseSshCommand(command: string): ParsedSshTarget | null {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "ssh") return null;
  let port = 22;
  let destination = "";
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-p" && tokens[index + 1]) {
      port = Number(tokens[index + 1]);
      index += 1;
    } else if (token.startsWith("-") || destination) {
      return null;
    } else {
      destination = token;
    }
  }
  const match = destination.match(/^([^@\s]+)@([^:\s]+)(?::(\d+))?$/);
  if (!match) return null;
  if (match[3]) port = Number(match[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { username: match[1], host: match[2], port };
}

export function quoteShellPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

export function pathFromOsc(value: string): string | null {
  if (!value.startsWith("file://")) return null;
  const slash = value.indexOf("/", "file://".length);
  if (slash < 0) return null;
  try {
    return decodeURIComponent(value.slice(slash));
  } catch {
    return value.slice(slash);
  }
}
