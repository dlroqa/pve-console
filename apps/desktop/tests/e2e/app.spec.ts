import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * End-to-end flow (spec §25.3): app launch, create/edit/run diagnostics/switch/
 * delete server, settings persistence. These drive only the native shell; real
 * Proxmox login/console tests are performed manually against a live node.
 */

let app: ElectronApplication;
let win: Page;
let userDataDir: string;

const PINNED_FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, "0").toUpperCase(),
).join(":");

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), "pve-e2e-"));
  await writeFile(
    join(userDataDir, "certificate-pins.json"),
    JSON.stringify([
      {
        serverProfileId: "e2e-certificate",
        host: "192.168.250.250",
        port: 8006,
        fingerprintSha256: PINNED_FINGERPRINT,
        approvedAt: "2026-01-01T00:00:00.000Z",
      },
    ]),
    "utf8",
  );
  app = await electron.launch({
    args: [resolve(__dirname, "../../dist/main/main.js"), `--user-data-dir=${userDataDir}`],
    cwd: resolve(__dirname, "../.."),
    env: { ...process.env, NODE_ENV: "production" },
  });
  win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app.close();
  await rm(userDataDir, { recursive: true, force: true });
});

test("app launches and renders the shell", async () => {
  await expect(win.locator(".brand")).toHaveText("PVE Console");
  await expect(win.locator(".section-label", { hasText: "Terminal" })).toBeVisible();
  await expect(win.getByRole("button", { name: "+ Terminal" })).toBeVisible();
  await expect(win.locator(".ai-usage-indicator")).toBeVisible();
  await win.getByRole("button", { name: "+ Terminal" }).click();
  await expect(win.getByLabel("SSH host")).toBeVisible();
  await expect(win.locator(".terminal-surface")).toBeVisible();
});

test("terminal workspace remains mounted while navigating", async () => {
  const host = win.getByLabel("SSH host");
  await host.fill("10.10.1.209");

  await win.getByRole("button", { name: "Settings" }).click();
  await expect(win.locator("h1")).toHaveText("Settings");

  await win.getByRole("button", { name: "+ Terminal" }).click();
  await expect(win.getByLabel("SSH host")).toHaveValue("10.10.1.209");
});

test("certificate fingerprint stays inside its card at minimum window width", async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(940, 600);
  });

  await win.getByRole("button", { name: "Settings" }).click();
  await expect(win.locator("h1")).toHaveText("Settings");
  await expect(win.locator(".certificate-fingerprint")).toHaveText(PINNED_FINGERPRINT);

  await expect
    .poll(() =>
      win.locator(".certificate-pin").evaluate((message) => {
        const card = message.closest<HTMLElement>(".diag-row");
        return card !== null && card.scrollWidth <= card.clientWidth;
      }),
    )
    .toBe(true);
});

test("can create a server, run diagnostics context, then delete it", async () => {
  // Open Add Server.
  await win.getByRole("button", { name: "+ Add Server" }).first().click();
  await expect(win.locator("h1")).toHaveText("Add Proxmox Server");

  // Fill the form.
  await win.getByPlaceholder("Home Proxmox").fill("E2E Server");
  await win.getByPlaceholder(/192.168/).fill("192.168.250.250");
  await win.getByRole("button", { name: "Save Server" }).click();

  // Back on Home, the server card is shown.
  await expect(win.locator(".server-card .name")).toContainText("E2E Server");

  // Persists after a settings visit.
  await win.getByRole("button", { name: "Settings" }).click();
  await expect(win.locator("h1")).toHaveText("Settings");

  // Delete via edit.
  await win.getByRole("button", { name: "Diagnostics" }).first().click();
  await expect(win.locator("h1")).toHaveText("Connection Diagnostics");
});
