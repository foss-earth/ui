import { defineConfig } from "vitest/config";

// Tests in real browsers: `npm run test:browser`. They start Chrome and
// Firefox, so `npm test` leaves them out.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/browser/**/*.browser.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
