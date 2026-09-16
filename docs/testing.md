# Testing

Build, render and test run on **GitHub Actions** (`.github/workflows/ci.yml`) so
the server build usage is reproducible and cross-platform. Packaging runs in
`.github/workflows/release.yml` across Windows, macOS and Linux.

## Levels (spec §25)

### Unit (`tests/unit`, Vitest)

- profile validation & defaults
- address / URL construction
- fingerprint normalization
- settings validation
- IPC allowlist (no generic execute channel)
- log sanitization (no secrets)
- session partition creation

### Integration (`tests/integration`, Vitest)

- profile persistence (survives restart, no plaintext secrets)
- certificate storage, pinning, mismatch blocking, trust-once runtime scope
- secret store interface (encrypted, separate file) — Electron `safeStorage` mocked
- SSH profile persistence (credentials encrypted and excluded from profile JSON)
- diagnostics orchestration (host/TCP failures reported separately, downstream skipped)
- session isolation partitions

### End-to-end (`tests/e2e`, Playwright + Electron)

- app launch, create server, navigate views, diagnostics context, delete

## Manual (real Proxmox node required — spec §25, Phases 6–8)

These require a live Proxmox VE server and are verified by hand:

- Proxmox login loads and authenticates inside the app
- VM list / LXC list load; navigation within Proxmox works
- noVNC VM console opens and stays connected
- xterm.js node/LXC shell; keyboard input (Ctrl/Alt/Shift/Esc/function keys)
- WebSocket stability during console use and window resize
- file upload / download
- cookies persist per-server only; logging out of one server does not affect another
- direct unsaved SSH password and private-key authentication against a live VM
- optional saved SSH connection reuse with encrypted credentials
- first-seen and changed SSH host-key confirmation
- interactive SSH input, output, terminal resizing and disconnect behavior

## Commands (executed by CI)

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e   # via xvfb on Linux runners
npm run package    # release workflow, per-OS
```
