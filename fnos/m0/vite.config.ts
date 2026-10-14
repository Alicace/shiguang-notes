import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(root, "ui"),
  base: "/app/fnnotes-m0/",
  plugins: [react()],
  build: { outDir: path.join(root, "dist"), emptyOutDir: true, rollupOptions: { input: { main: path.join(root, "ui/index.html"), callback: path.join(root, "ui/auth-callback.html") } } },
});
