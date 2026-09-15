# Server Profiles

A server profile is a strongly typed record (spec §7) stored in the non-secret
config store (`profiles.json` under the app's userData directory).

```ts
interface ServerProfile {
  id: string;
  name: string;
  protocol: "https" | "http";
  host: string;
  port: number;
  connectionMode: "direct" | "tailscale" | "vpn" | "domain";
  certificateMode: "system" | "pinned" | "trust-once";
  pinnedFingerprint?: string;
  autoConnect: boolean;
  createdAt: string;
  updatedAt: string;
}
```

## Defaults

| Field           | Default   |
| --------------- | --------- |
| protocol        | `https`   |
| port            | `8006`    |
| connectionMode  | `direct`  |
| certificateMode | `system`  |
| autoConnect     | `false`   |

## Address handling (spec §8)

Accepted host forms: IPv4, IPv6, DNS hostname, domain, Tailscale hostname/IP, and
other private VPN-routable addresses. No LAN subnet is hard-coded. The base URL is
constructed as `{protocol}://{host}:{port}` (IPv6 literals are bracketed).

## Rules

- Duplicate names are allowed as long as ids differ.
- Invalid host, port, protocol, id, certificate mode or connection mode are
  rejected by `profile-schema.ts`.
- Profiles never contain plaintext secrets; the schema rejects secret-bearing
  fields.
- Each profile gets an isolated persistent Electron session `persist:pve-{id}`
  (spec §9). Deleting a profile also removes its certificate pin and view.
