import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
    maxWorkers: "50%",
    // Fixtures and the retained diagnostics import graph are read from disk.
    forceRerunTriggers: [...configDefaults.forceRerunTriggers, "**/fixtures/**", "**/tests/package-consumer.mjs", "**/tests/prepare-consumer-dependencies.mjs", "**/src/diagnostics/**", "**/src/settings/**", "**/src/log/**", "**/package.json", "**/package-lock.json", "**/vitest.config.*"],
  },
  oxc: { jsx: { runtime: "automatic" } },
});
