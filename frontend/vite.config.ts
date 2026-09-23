import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite dev server proxies /api calls to the FastAPI backend on :8000
export default defineConfig({
  plugins: [react()],
  // Static assets (ambient store music, etc.) live in src/public rather than
  // Vite's default <root>/public, so they are served/copied from there verbatim.
  publicDir: "src/public",
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
