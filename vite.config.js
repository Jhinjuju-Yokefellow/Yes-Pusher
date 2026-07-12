import { defineConfig } from 'vite';

export default defineConfig({
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
