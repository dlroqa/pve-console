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
  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({
    args: [resolve(__dirname, "../../dist/main/main.js"), `--user-data-dir=${userDataDir}`],
    cwd: resolve(__dirname, "../.."),
    env: { ...electronEnv, NODE_ENV: "production" },
  });
  win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await app?.close();
  await rm(userDataDir, { recursive: true, force: true });
});

test("app launches and renders the shell", async () => {
  await expect(win.locator(".brand")).toHaveText("PVE Console");
  await expect(win.locator(".section-label", { hasText: "Terminal" })).toBeVisible();
  const sidebarToggle = win.getByRole("button", { name: "Hide navigation sidebar" });
  const widthWithSidebar = await win.locator("main").evaluate((main) => main.getBoundingClientRect().width);
  await sidebarToggle.click();
  await expect(win.locator("#primary-sidebar")).toHaveCount(0);
  await expect(win.getByRole("button", { name: "Show navigation sidebar" })).toHaveAttribute("aria-expanded", "false");
  const widthWithoutSidebar = await win.locator("main").evaluate((main) => main.getBoundingClientRect().width);
  expect(widthWithoutSidebar).toBeGreaterThan(widthWithSidebar);
  await win.getByRole("button", { name: "Show navigation sidebar" }).click();
  await expect(win.locator("#primary-sidebar")).toBeVisible();
  await expect(win.getByRole("button", { name: "+ Terminal" })).toBeVisible();
  const usage = win.locator(".ai-usage-indicator");
  await expect(usage).toBeVisible();
  await expect(usage).toHaveAttribute("aria-expanded", "true");
  await usage.click();
  await expect(usage).toHaveClass(/compact/);
  await expect(usage).toHaveAttribute("aria-expanded", "false");
  await usage.click();
  await win.getByRole("button", { name: "+ Terminal" }).click();
  await expect(win.getByLabel("Local file explorer")).toBeVisible();
  await expect(win.locator(".terminal-surface")).toBeVisible();
  await expect(win.locator(".terminal-target")).toContainText("Local");
  await win.locator(".persistent-terminal.active .terminal-surface").click();
  await win.keyboard.type("cd /tmp");
  await win.keyboard.press("Enter");
  await expect(win.locator(".persistent-terminal.active .terminal-target")).toContainText("/tmp");
});

test("terminal workspaces remain independent and mounted while navigating", async () => {
  const activeRows = () => win.locator(".persistent-terminal.active .xterm-rows");
  const activeSurface = () => win.locator(".persistent-terminal.active .terminal-surface");

  await activeSurface().click();
  await win.keyboard.type("printf 'FIRST_SESSION_MARKER\n'");
  await win.keyboard.press("Enter");
  await expect(activeRows()).toContainText("FIRST_SESSION_MARKER");
  await win.getByRole("button", { name: "Rename Terminal 1" }).click();
  const terminalName = win.getByLabel("Rename Terminal 1");
  await terminalName.fill("API logs");
  await terminalName.press("Enter");
  await expect(win.getByRole("button", { name: /^API logs/ })).toBeVisible();

  await win.getByRole("button", { name: "Settings" }).click();
  await expect(win.locator("h1")).toHaveText("Settings");
  await win.getByRole("button", { name: /^API logs/ }).click();
  await expect(activeRows()).toContainText("FIRST_SESSION_MARKER");

  await win.getByRole("button", { name: "+ Terminal" }).click();
  await expect(win.getByRole("button", { name: /^Terminal 2/ })).toBeVisible();
  await activeSurface().click();
  await win.keyboard.type("printf 'SECOND_SESSION_MARKER\n'");
  await win.keyboard.press("Enter");
  await expect(activeRows()).toContainText("SECOND_SESSION_MARKER");

  await win.getByRole("button", { name: /^API logs/ }).click();
  await expect(activeRows()).toContainText("FIRST_SESSION_MARKER");
  await win.getByRole("button", { name: /^Terminal 2/ }).click();
  await expect(activeRows()).toContainText("SECOND_SESSION_MARKER");
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

  // Back on Home, the server card is shown and can be renamed inline.
  await expect(win.locator(".server-card .name")).toContainText("E2E Server");
  await win.getByRole("button", { name: "Rename E2E Server" }).click();
  const serverName = win.getByLabel("Rename E2E Server");
  await serverName.fill("Lab PVE");
  await serverName.press("Enter");
  await expect(win.getByRole("button", { name: /^Lab PVE/ })).toBeVisible();

  // Persists after a settings visit.
  await win.getByRole("button", { name: "Settings" }).click();
  await expect(win.locator("h1")).toHaveText("Settings");

  // Delete via edit.
  await win.getByRole("button", { name: "Diagnostics" }).first().click();
  await expect(win.locator("h1")).toHaveText("Connection Diagnostics");
});
