import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "#web": resolve(import.meta.dirname, "src"),
      "#shared": resolve(import.meta.dirname, "..", "shared"),
    },
  },
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("recharts") || id.includes("d3-")) return "recharts";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
