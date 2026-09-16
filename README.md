# PVE Console

A secure, dedicated desktop application for Proxmox VE.

PVE Console opens and manages Proxmox VE similarly to a normal browser, but inside a
purpose-built, hardened desktop shell. You configure a Proxmox server by IP address or
domain, safely accept/pin its TLS certificate, and sign into the real Proxmox interface
inside the app — with independent, isolated sessions per server.

The Terminal section opens directly into SSH sessions for VMs and hosts with
password or private-key authentication. Connections can stay session-only or be
saved with encrypted credential storage, and every host key requires explicit
SHA-256 verification.

## Technology stack

- **Desktop runtime:** Electron
- **Frontend:** React
- **Language:** TypeScript
- **Bundler:** Vite
- **Embedded UI:** Electron `WebContentsView`
- **Remote terminal:** xterm.js + SSH2
- **Package manager:** npm
- **Secret storage:** Electron `safeStorage` / OS credential store
- **Testing:** Vitest + Playwright
- **Packaging:** electron-builder

## Getting started

```bash
npm install
npm run dev
```

## Scripts

| Script              | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `npm run dev`       | Start the app in development mode          |
| `npm run build`     | Build main, preload and renderer bundles   |
| `npm run test`      | Run unit and integration tests             |
| `npm run lint`      | Lint the codebase                          |
| `npm run typecheck` | Type-check the codebase                    |
| `npm run package`   | Produce packaged desktop artifacts         |

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Server profiles](docs/server-profiles.md)
- [Testing](docs/testing.md)

## Security posture

Remote Proxmox content runs with `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true`, and `webSecurity: true`. There is no global TLS bypass — self-signed
certificates are handled through explicit trust and SHA-256 fingerprint pinning. IPC is
restricted to a fixed allowlist. See [docs/security.md](docs/security.md).
