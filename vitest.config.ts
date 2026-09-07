import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "prototypes/review-workbench/**/*.test.js",
      "scripts/**/*.test.mjs",
    ],
    exclude: ["**/*.integration.test.ts"],
  },
});
