import { defineConfig } from "@playwright/test";

// End-to-end tests drive the packaged Electron application via Playwright's
// Electron support. See tests/e2e for the specs.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    trace: "on-first-retry",
  },
});
