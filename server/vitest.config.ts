import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Single shared SQLite database — run files sequentially.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
