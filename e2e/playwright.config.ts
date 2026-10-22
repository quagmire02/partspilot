import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the LOCAL stack: Supabase (supabase start), the Worker
 * (wrangler dev --env local), the PWA static export served like Cloudflare Pages, and
 * the desktop UI in web mode (Vite) — the same React app the Tauri shell loads.
 */
export default defineConfig({
  testDir: "./pw",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    serviceWorkers: "allow",
    // Fake camera so the live-viewfinder path is testable headless.
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", testMatch: /(capture|timing)\.spec\.ts/, use: { ...devices["Pixel 7"], baseURL: "http://localhost:3000" } },
    { name: "desktop", testMatch: /(desktop|journey)\.spec\.ts/, use: { baseURL: "http://localhost:1420", viewport: { width: 1360, height: 900 } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @partspilot/api exec wrangler pages dev ../capture/out --port 3000 --ip localhost",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @partspilot/desktop dev",
      url: "http://localhost:1420",
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});
