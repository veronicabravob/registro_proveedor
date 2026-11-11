import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// En desarrollo, Vite sirve el front en :5173 y reenvía /api al backend en :3000 (mismo origen,
// sin CORS). En producción el backend sirve frontend/dist directamente.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { outDir: "dist", sourcemap: false },
})
