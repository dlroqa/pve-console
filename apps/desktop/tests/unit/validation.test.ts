import { describe, it, expect } from "vitest";
import {
  isValidHost,
  isValidPort,
  isIPv4,
  isIPv6,
  isHostname,
  isDnsHost,
  buildBaseUrl,
  socketHost,
} from "../../src/shared/validation";

describe("address validation (spec §8)", () => {
  it("accepts IPv4 addresses", () => {
    expect(isIPv4("192.168.12.10")).toBe(true);
    expect(isIPv4("10.10.20.15")).toBe(true);
    expect(isIPv4("100.64.0.1")).toBe(true);
    expect(isIPv4("999.1.1.1")).toBe(false);
    expect(isIPv4("1.2.3")).toBe(false);
  });

  it("accepts IPv6 addresses", () => {
    expect(isIPv6("::1")).toBe(true);
    expect(isIPv6("fe80::1")).toBe(true);
    expect(isIPv6("2001:db8::8a2e:370:7334")).toBe(true);
    expect(isIPv6("not:an:ipv6:zzzz")).toBe(false);
    expect(isIPv6("192.168.0.1")).toBe(false);
  });

  it("accepts DNS hostnames, domains and Tailscale names", () => {
    expect(isHostname("pve.home.lan")).toBe(true);
    expect(isHostname("pve.example.com")).toBe(true);
    expect(isHostname("pve-machine.tailnet-name.ts.net")).toBe(true);
    expect(isHostname("bad_host")).toBe(false);
    expect(isHostname("-leading.com")).toBe(false);
  });

  it("isValidHost accepts all supported forms", () => {
    for (const h of [
      "192.168.12.10",
      "10.10.20.15",
      "100.101.102.103",
      "pve.home.lan",
      "pve.example.com",
      "pve-machine.tailnet-name.ts.net",
      "fe80::1",
    ]) {
      expect(isValidHost(h)).toBe(true);
    }
    expect(isValidHost("")).toBe(false);
    expect(isValidHost(123)).toBe(false);
  });

  it("distinguishes DNS hosts from IPs", () => {
    expect(isDnsHost("pve.example.com")).toBe(true);
    expect(isDnsHost("192.168.0.1")).toBe(false);
    expect(isDnsHost("fe80::1")).toBe(false);
  });

  it("validates ports within range", () => {
    expect(isValidPort(8006)).toBe(true);
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(70000)).toBe(false);
    expect(isValidPort(3.14)).toBe(false);
    expect(isValidPort("8006")).toBe(false);
  });
});

describe("URL construction (spec §8)", () => {
  it("builds {protocol}://{host}:{port}", () => {
    expect(buildBaseUrl("https", "192.168.12.10", 8006)).toBe("https://192.168.12.10:8006");
    expect(buildBaseUrl("https", "pve.example.com", 8006)).toBe("https://pve.example.com:8006");
    expect(buildBaseUrl("http", "10.10.20.15", 80)).toBe("http://10.10.20.15:80");
  });

  it("brackets IPv6 literals", () => {
    expect(buildBaseUrl("https", "fe80::1", 8006)).toBe("https://[fe80::1]:8006");
  });

  it("socketHost strips IPv6 brackets", () => {
    expect(socketHost("[fe80::1]")).toBe("fe80::1");
    expect(socketHost("192.168.0.1")).toBe("192.168.0.1");
  });
});
