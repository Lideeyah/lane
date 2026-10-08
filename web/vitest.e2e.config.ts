import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["src/e2e/**/*.e2e.ts"], testTimeout: 120_000, hookTimeout: 60_000, env: loadEnv("production", process.cwd(), "") },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
