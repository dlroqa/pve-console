import { describe, expect, it } from "vitest";
import { parseSshCommand, pathFromOsc, quoteShellPath } from "../../src/renderer/terminal-command";

describe("terminal command integration", () => {
  it("parses standard and host:port SSH destinations", () => {
    expect(parseSshCommand("ssh aidev@10.10.1.209")).toEqual({ username: "aidev", host: "10.10.1.209", port: 22 });
    expect(parseSshCommand("ssh -p 2222 aidev@example.test")).toEqual({ username: "aidev", host: "example.test", port: 2222 });
    expect(parseSshCommand("ssh aidev@10.10.1.209:2200")).toEqual({ username: "aidev", host: "10.10.1.209", port: 2200 });
  });

  it("leaves unsupported or unsafe command shapes to the local shell", () => {
    expect(parseSshCommand("ssh host-only")).toBeNull();
    expect(parseSshCommand("ssh -i key aidev@example.test")).toBeNull();
    expect(parseSshCommand("ssh -p 70000 aidev@example.test")).toBeNull();
    expect(parseSshCommand("echo ssh aidev@example.test")).toBeNull();
  });

  it("quotes paths and decodes OSC 7 working directories", () => {
    expect(quoteShellPath("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
    expect(pathFromOsc("file://host/home/me/My%20Project")).toBe("/home/me/My Project");
    expect(pathFromOsc("https://example.test/path")).toBeNull();
  });
});
