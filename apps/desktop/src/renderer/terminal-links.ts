export type TerminalLinkPlatform = "darwin" | "other";

export function terminalLinkPlatform(platform: string): TerminalLinkPlatform {
  return platform === "darwin" ? "darwin" : "other";
}

export function terminalLinkHint(platform: TerminalLinkPlatform): string {
  return platform === "darwin" ? "Command-click to open link" : "Ctrl-click to open link";
}

export function shouldOpenTerminalLink(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  platform: TerminalLinkPlatform,
): boolean {
  return platform === "darwin" ? event.metaKey : event.ctrlKey;
}
