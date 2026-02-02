import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,          // 0.0.0.0
    port: 4173,
    strictPort: true,
    hmr: { clientPort: 4173 },
    proxy: {
      '/api': {
        target: process.env.VITE_ANALYTICS_BACKEND_URL || 'http://analytics-backend:4001',
        changeOrigin: true,
        secure: false,
        // Fallback to localhost if Docker hostname doesn't work
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.log('Proxy error, trying localhost fallback');
          });
        },
      },
      '/kb-api': {
        target: process.env.VITE_KB_BACKEND_URL || 'http://app:8000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/kb-api/, ''),
        // Fallback to localhost if Docker hostname doesn't work
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.log('KB API proxy error, trying localhost fallback');
          });
        },
      },
    }
  }
});
