import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
  ],
  root: path.join(process.cwd(), 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(process.cwd(), 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer', import.meta.url)),
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
    // Add parent node_modules to resolve path for workspace dependencies
    preserveSymlinks: false,
    dedupe: ['vue', 'vue-router', 'pinia'],
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
