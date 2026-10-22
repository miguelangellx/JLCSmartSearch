import { defineConfig } from "vite";

const apiProxy = {
  "/api": {
    target: process.env.VITE_API_PROXY_TARGET ?? "http://127.0.0.1:3000",
    changeOrigin: true,
  },
};

export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  publicDir: "public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: apiProxy,
    warmup: {
      clientFiles: ["./app.js"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PREVIEW_PORT ?? 4173),
    strictPort: true,
    proxy: apiProxy,
  },
});
