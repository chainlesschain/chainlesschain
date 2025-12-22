import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import path from 'path';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

export default defineConfig({
  plugins: [
    vue(),
    monacoEditorPlugin({
      publicPath: 'monacoeditorwork',
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
      customWorkers: [
        {
          label: 'yaml',
          entry: 'monaco-yaml/yaml.worker',
        },
      ],
    }),
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
      'monaco-editor': path.resolve(__dirname, '../node_modules/monaco-editor'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
