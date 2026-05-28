import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, 'src/sim'),
      '@render': path.resolve(__dirname, 'src/render'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@debug': path.resolve(__dirname, 'src/debug'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
