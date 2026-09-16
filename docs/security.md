# Security

Security decisions in PVE Console are mandatory (spec §6, §26).

## Remote content isolation (spec §6.1)

Embedded Proxmox pages run with:

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true`
- `webviewTag: false`

The remote page has no preload bridge, so it cannot reach `require`, `process`,
`child_process`, `fs`, or any Electron privileged API.

## IPC allowlist (spec §6.2)

`src/shared/ipc-channels.ts` defines the ONLY channels the preload bridge and
main process accept. There is no generic `execute` / `run` / `invoke(arbitrary)`
surface. The preload (`src/main/preload.ts`) exposes a fixed, typed API on
`window.pve` and validates event-channel subscriptions against the allowlist.

## Certificate handling (spec §14)

No global TLS bypass is ever used, and Electron is never launched with
`--ignore-certificate-errors`. Each isolated session installs a certificate
verification procedure that:

- accepts pinned or explicitly trusted certificates;
- prompts the user for unknown self-signed certificates (Trust Once / Trust &
  Pin);
- **blocks automatically** on a fingerprint mismatch and never replaces a pin
  without explicit user confirmation.

Fingerprints are SHA-256, normalized to `AA:BB:CC:…` (spec §5.1).

## Secrets (spec §6.3, §37)

Server profile files contain no plaintext credentials — the schema rejects any
secret-bearing field. Sensitive values (API tokens, SSH passwords, SSH private
keys and key passphrases) are encrypted via Electron `safeStorage` (OS
credential store) in a separate file from config. SSH credentials never cross
into embedded Proxmox content.

## SSH host verification

Remote terminal sessions run in the main process and require an explicit host
key decision for first-seen keys. Saved SHA-256 fingerprints are checked on
every connection. A changed key produces a blocking warning that shows both
the previous and presented fingerprints; it is never replaced silently.

## Navigation (spec §6.4, §41)

Remote content may navigate only within the active profile's trusted origin;
external origins open in the system browser. The native shell is locked to its
own origin.

## Logging (spec §21)

The logger redacts passwords, tokens, cookies, CSRF tokens, private keys and
Authorization headers before writing.
