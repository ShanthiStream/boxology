import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `bun run dev` gives you HMR on :5173 while `bun run dev:worker`
    // serves the API on :8787. This proxy stitches the two together so
    // you can develop without rebuilding the worker on every change.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
