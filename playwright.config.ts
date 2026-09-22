import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4312", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:4312/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: "4312",
      APP_ORIGIN: "http://127.0.0.1:4312",
      HOST: "127.0.0.1",
      DATA_DIR: "/tmp/council-e2e-data",
      DEMO_DELAY_MS: "3",
    },
  },
});
