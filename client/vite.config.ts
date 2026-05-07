import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173
  },
  resolve: {
    alias: {
      buffer: "buffer"
    }
  },
  define: {
    global: "globalThis"
  },
  optimizeDeps: {
    include: ["buffer", "@solana/web3.js"],
    esbuildOptions: {
      define: {
        global: "globalThis"
      }
    }
  }
});
