import { defineConfig } from "vitest/config";

// Playwright owns pw/*.spec.ts; vitest runs only the API-level suites in tests/.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 90_000 },
});
