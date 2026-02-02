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
        target: 'http://analytics-backend:4001',
        changeOrigin: true,
        secure: false,
      },
      '/kb-api': {
        target: 'http://app:8000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/kb-api/, ''),
      },
    }
  }
});
