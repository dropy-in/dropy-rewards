import { defineConfig } from "vitest/config";

// Dedicated config so tests don't load the React Router build plugin from vite.config.ts.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
