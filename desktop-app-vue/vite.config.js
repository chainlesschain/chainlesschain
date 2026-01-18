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
    // 🚀 性能优化：代码分割和压缩
    rollupOptions: {
      output: {
        // 手动分块：将大型库分离到独立的 chunk
        manualChunks: {
          'monaco': ['monaco-editor'],
          'charts': ['echarts', 'echarts-gl'],
          'editor': ['@milkdown/core', '@milkdown/preset-commonmark', '@milkdown/preset-gfm'],
          'codemirror': ['@codemirror/state', '@codemirror/view', '@codemirror/lang-javascript', '@codemirror/lang-css', '@codemirror/lang-html'],
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'ui': ['ant-design-vue'],
        },
        // 优化 chunk 文件名
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // 设置 chunk 大小警告限制（1MB）
    chunkSizeWarningLimit: 1000,
    // 使用 terser 进行代码压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        // 生产环境移除 console 和 debugger
        drop_console: process.env.NODE_ENV === 'production',
        drop_debugger: true,
        pure_funcs: process.env.NODE_ENV === 'production' ? ['console.log', 'console.info'] : [],
      },
      format: {
        // 移除注释
        comments: false,
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 生成 sourcemap（开发环境）
    sourcemap: process.env.NODE_ENV !== 'production',
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
    include: ['monaco-editor', 'echarts', 'ant-design-vue'],
    // 排除不需要预构建的依赖
    exclude: [],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
