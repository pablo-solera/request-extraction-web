import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.resolve(root, "tests/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.ts", "db/*.ts"],
      exclude: ["**/*.d.ts", "**/*.config.*", "db/migrations/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { statements: 8, branches: 5, functions: 5, lines: 8 },
    },
  },
});
