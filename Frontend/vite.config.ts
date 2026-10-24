import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri dev expects port 1420 with a fixed origin.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", target: "es2021", minify: true },
  envPrefix: ["VITE_", "TAURI_"],
});
