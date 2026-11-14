import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const server = process.env.CELLO_SERVER ?? "127.0.0.1:4748"

// The socket, and review evidence (videos, screenshots), come from the Cello server.
const proxy = {
  "/rpc": { target: `ws://${server}`, ws: true },
  "/attachments": { target: `http://${server}` },
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    port: Number(process.env.CELLO_WEB_PORT ?? 5199),
    strictPort: true,
    proxy,
  },
  preview: {
    port: Number(process.env.CELLO_WEB_PORT ?? 5199),
    strictPort: true,
    proxy,
  },
})
