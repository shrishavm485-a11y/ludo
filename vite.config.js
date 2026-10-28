import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client lives in /client; the production build goes to /dist and is served by server/index.js.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true, port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true }, '/healthz': 'http://localhost:3000' },
  },
});
