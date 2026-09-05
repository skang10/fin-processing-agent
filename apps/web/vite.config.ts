import { defineConfig } from "vite";

export default defineConfig({
  root: "../../prototypes/review-workbench",
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
});
