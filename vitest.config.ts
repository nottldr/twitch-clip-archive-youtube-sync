import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "server/__tests__",
    globals: true,
  },
  resolve: {
    alias: {
      "#server": resolve(import.meta.dirname, "server"),
      "#shared": resolve(import.meta.dirname, "shared"),
    },
  },
});
