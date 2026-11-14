import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5199, strictPort: true, proxy: { "/rpc": { target: "ws://127.0.0.1:4747", ws: true } } },
})
