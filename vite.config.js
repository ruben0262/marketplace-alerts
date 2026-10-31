import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Preserve the browser's Host alongside Origin so same-origin writes also
  // work through 127.0.0.1 or another Vite port, without weakening API checks.
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
  build: { chunkSizeWarningLimit: 350 },
});
