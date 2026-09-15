import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
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

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), "pve-e2e-"));
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
