import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const backend = env.VITE_DEV_BACKEND || 'http://localhost:4000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // In development the API and the socket are proxied, so the browser talks to one origin.
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/socket.io': { target: backend, ws: true, changeOrigin: true },
      },
    },
  };
});
