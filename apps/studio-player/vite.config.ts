import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PLAYER_PORT = parseInt(process.env.PLAYER_PORT ?? "9521", 10);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/ws": {
        target: `ws://localhost:${PLAYER_PORT}`,
        ws: true,
      },
    },
  },
  build: { outDir: "dist" },
});
