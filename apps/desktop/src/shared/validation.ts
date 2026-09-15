/**
 * Address, port and URL validation shared across profile schema validation,
 * diagnostics and the renderer forms (spec §8).
 *
 * Accepts IPv4, IPv6, DNS hostnames, domain names and Tailscale-style hostnames.
 * Does NOT hard-code any LAN subnet (spec §7 / §0.2).
 */

import { MIN_PORT, MAX_PORT, PROTOCOLS } from "./constants";
import type { Protocol } from "./types";

export function isValidPort(port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= MIN_PORT &&
    port <= MAX_PORT
  );
}

export function isValidProtocol(value: unknown): value is Protocol {
  return typeof value === "string" && (PROTOCOLS as readonly string[]).includes(value);
}

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIPv4(host: string): boolean {
  return IPV4.test(host);
}

/**
 * Reasonable IPv6 detection. Not a full RFC grammar, but accepts the common
 * forms (full, compressed "::", and IPv4-mapped). Rejects obvious garbage.
 */
export function isIPv6(host: string): boolean {
  const h = host.trim();
  if (!h.includes(":")) return false;
  // Disallow characters outside the IPv6 alphabet.
  if (!/^[0-9a-fA-F:.]+$/.test(h)) return false;
  // At most one "::" compression.
  const doubleColons = (h.match(/::/g) || []).length;
  if (doubleColons > 1) return false;
  const groups = h.split(":");
  // Between 2 and 8 groups depending on compression / embedded IPv4.
  if (groups.length < 2 || groups.length > 8) return false;
  for (const g of groups) {
    if (g === "") continue; // from "::"
    if (g.includes(".")) {
      if (!isIPv4(g)) return false;
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return false;
  }
  return true;
}

const HOSTNAME_LABEL = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/;

/**
 * A DNS hostname / domain / Tailscale name (e.g. pve.home.lan,
 * pve.example.com, pve-machine.tailnet-name.ts.net).
 */
export function isHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  if (isIPv4(host) || isIPv6(host)) return false;
  const labels = host.split(".");
  return labels.every((label) => HOSTNAME_LABEL.test(label));
}

/** True for any accepted host form. */
export function isValidHost(host: unknown): host is string {
  if (typeof host !== "string") return false;
  const h = host.trim();
  if (h.length === 0) return false;
  return isIPv4(h) || isIPv6(h) || isHostname(h);
}

/** True when the host is a name that requires DNS resolution (spec §15 step 2). */
export function isDnsHost(host: string): boolean {
  return isHostname(host);
}

/**
 * Construct the base URL for a Proxmox server. IPv6 literals are bracketed.
 * Result form: {protocol}://{host}:{port} (spec §8).
 */
export function buildBaseUrl(protocol: Protocol, host: string, port: number): string {
  const h = host.trim();
  const bracketed = isIPv6(h) && !h.startsWith("[") ? `[${h}]` : h;
  return `${protocol}://${bracketed}:${port}`;
}

/** The host as it should be used in a network socket (IPv6 without brackets). */
export function socketHost(host: string): string {
  const h = host.trim();
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}
