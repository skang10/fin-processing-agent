import { defineConfig } from "vite";

const apiProxyTarget = process.env["API_PROXY_TARGET"] ?? "http://127.0.0.1:3000";

export default defineConfig({
  root: "../../prototypes/review-workbench",
  publicDir: "../../output/pdf",
  server: {
    port: 5173,
    proxy: { "/api": apiProxyTarget },
  },
  preview: { host: "0.0.0.0", port: 5173, proxy: { "/api": apiProxyTarget } },
});
