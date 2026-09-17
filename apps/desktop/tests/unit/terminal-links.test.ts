import { describe, expect, it } from "vitest";
import {
  shouldOpenTerminalLink,
  terminalLinkHint,
  terminalLinkPlatform,
} from "../../src/renderer/terminal-links";

describe("terminal link interaction", () => {
  it("requires Command-click on macOS", () => {
    expect(shouldOpenTerminalLink({ metaKey: true, ctrlKey: false }, "darwin")).toBe(true);
    expect(shouldOpenTerminalLink({ metaKey: false, ctrlKey: true }, "darwin")).toBe(false);
    expect(terminalLinkHint("darwin")).toBe("Command-click to open link");
  });

  it("requires Ctrl-click on other platforms", () => {
    expect(shouldOpenTerminalLink({ metaKey: false, ctrlKey: true }, "other")).toBe(true);
    expect(shouldOpenTerminalLink({ metaKey: true, ctrlKey: false }, "other")).toBe(false);
    expect(terminalLinkHint("other")).toBe("Ctrl-click to open link");
  });

  it("maps only Electron's darwin platform to the macOS modifier", () => {
    expect(terminalLinkPlatform("darwin")).toBe("darwin");
    expect(terminalLinkPlatform("win32")).toBe("other");
    expect(terminalLinkPlatform("linux")).toBe("other");
  });
});
