import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        rebuild: resolve(process.cwd(), 'rebuild.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:8787',
      '/events': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
