import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const server = process.env.CELLO_SERVER ?? "127.0.0.1:4748"

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    port: Number(process.env.CELLO_WEB_PORT ?? 5199),
    strictPort: true,
    proxy: { "/rpc": { target: `ws://${server}`, ws: true } },
  },
  preview: {
    port: Number(process.env.CELLO_WEB_PORT ?? 5199),
    strictPort: true,
    proxy: { "/rpc": { target: `ws://${server}`, ws: true } },
  },
})
