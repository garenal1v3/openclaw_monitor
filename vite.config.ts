import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "src/shared") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3800",
      "/ws": { target: "ws://localhost:3800", ws: true },
    },
  },
  build: {
    outDir: "dist/client",
  },
});
