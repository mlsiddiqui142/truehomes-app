import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  base: "/react/",
  build: {
    outDir: "public/react",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.react.html",
    },
  },
});
