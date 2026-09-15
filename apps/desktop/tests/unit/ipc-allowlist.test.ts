import { describe, it, expect } from "vitest";
import {
  isInvokeChannel,
  isEventChannel,
  INVOKE_CHANNELS,
  EVENT_CHANNELS,
} from "../../src/shared/ipc-channels";

describe("IPC allowlist (spec §6.2)", () => {
  it("recognizes approved invoke channels", () => {
    expect(isInvokeChannel("profiles:list")).toBe(true);
    expect(isInvokeChannel("diagnostics:run")).toBe(true);
    expect(isInvokeChannel("certificate:respond")).toBe(true);
  });

  it("rejects unapproved / generic channels", () => {
    expect(isInvokeChannel("execute")).toBe(false);
    expect(isInvokeChannel("run")).toBe(false);
    expect(isInvokeChannel("invoke")).toBe(false);
    expect(isInvokeChannel("shell:exec")).toBe(false);
    expect(isInvokeChannel("anything")).toBe(false);
  });

  it("has no generic execute/run channel in the allowlist", () => {
    for (const ch of INVOKE_CHANNELS) {
      expect(["execute", "run", "invoke", "exec", "eval"]).not.toContain(ch);
    }
  });

  it("recognizes approved event channels only", () => {
    expect(isEventChannel("certificate:prompt")).toBe(true);
    expect(isEventChannel("server:navigation")).toBe(true);
    expect(isEventChannel("totally:made-up")).toBe(false);
  });

  it("channel lists are non-empty and unique", () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(new Set(EVENT_CHANNELS).size).toBe(EVENT_CHANNELS.length);
  });
});
