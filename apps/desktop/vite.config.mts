import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Renderer-only Vite configuration. The Electron main and preload processes are
// compiled separately with `tsc` (see tsconfig.main.json). Using a relative base
// lets the packaged renderer load correctly from the file:// protocol.
export default defineConfig({
  root: resolve(import.meta.dirname, "src/renderer"),
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
