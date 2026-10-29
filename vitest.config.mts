import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], testTimeout: 20000, fileParallelism: false },
  resolve: {
    alias: {
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
