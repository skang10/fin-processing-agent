import { defineConfig } from "vite";
import { createRequire } from "node:module";

const apiProxyTarget = process.env["API_PROXY_TARGET"] ?? "http://127.0.0.1:3000";
const require = createRequire(import.meta.url);

export default defineConfig({
  root: "../../prototypes/review-workbench",
  publicDir: "../../output/pdf",
  resolve: {
    alias: [
      { find: /^pdfjs-dist$/, replacement: require.resolve("pdfjs-dist/build/pdf.mjs") },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/, replacement: `${require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")}?url` },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs$/, replacement: require.resolve("pdfjs-dist/build/pdf.worker.min.mjs") },
    ],
  },
  server: {
    port: 5173,
    proxy: { "/api": apiProxyTarget },
  },
  preview: { host: "0.0.0.0", port: 5173, proxy: { "/api": apiProxyTarget } },
});
