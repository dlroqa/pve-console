# Architecture

PVE Console is an Electron desktop application that embeds the real Proxmox VE web
interface inside a hardened, purpose-built shell (spec §5, §51).

## Processes

```
Electron Main Process            React Renderer (native shell)
  ├── Window Manager               ├── App Shell (Topbar + Sidebar + Main)
  ├── Session Manager              ├── Home / Add / Edit Server
  ├── Certificate Manager          ├── Diagnostics
  ├── Navigation Manager           ├── Settings
  ├── Download Manager             └── Server Workspace
  ├── WebContentsView Manager
  ├── Profile Manager
  ├── Diagnostics Engine
  ├── Proxmox API Client (V2 foundation)
  └── SSH Service
            │ HTTPS / WebSocket       │ SSH
            ▼                         ▼
      Proxmox pveproxy :8006       VM / host :22
```

- **Main process** (`src/main`, plus the trusted modules under `src/profiles`,
  `src/certificates`, `src/diagnostics`, `src/storage`, `src/proxmox`): owns all
  privileged logic. Compiled with `tsc` to `dist/`.
- **Renderer** (`src/renderer`): the native application UI. Built by Vite to
  `dist/renderer`. No Node access; talks to the main process only through the
  allowlisted preload bridge.
- **Embedded Proxmox content**: rendered with `WebContentsView` (never an
  `<iframe>` or `<webview>` tag), each in its own isolated persistent session.
- **SSH terminal** (`src/ssh`): connection profiles, encrypted credential
  lookup, host-key verification and SSH streams remain in the trusted main
  process. The renderer receives terminal output and sends keystrokes through
  narrowly allowlisted IPC channels.

## Layer boundaries

- The embedded Proxmox browser and the native application UI are separate logical
  layers (spec §5). The native shell never renders remote content in-process; the
  embedded view never receives the native preload bridge.
- Proxmox REST API calls live only in `src/proxmox` and are invoked from the
  trusted main process, never from React components or remote page JavaScript
  (spec §36). The API layer is Version 2 foundation and is not wired into
  Version 1 features (spec §53).

## Connection state machine (spec §32)

`IDLE → VALIDATING → CONNECTING → { CERTIFICATE_REVIEW → CONNECTING | CONNECTED |
ERROR }`, with explicit states rather than a single boolean.
