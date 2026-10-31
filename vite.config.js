import { defineConfig } from 'vite';

const fobeApiTarget = process.env.FOBE_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: fobeApiTarget,
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, '')
      }
    }
  }
});
