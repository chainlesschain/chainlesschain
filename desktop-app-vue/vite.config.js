import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import path from "path";
import Components from "unplugin-vue-components/vite";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

export default defineConfig({
  plugins: [
    vue(),
    // Ant Design Vue 按需导入
    Components({
      resolvers: [
        AntDesignVueResolver({
          importStyle: false, // css 已在 main.js 中全局导入
        }),
      ],
      dts: "src/components.d.ts", // 生成类型声明文件
    }),
  ],
  root: path.join(process.cwd(), "src/renderer"),
  base: "./",
  build: {
    outDir: path.join(process.cwd(), "dist/renderer"),
    emptyOutDir: true,
    // Disable modulepreload polyfill — Vite 7 + Rollup 4.60+ strict mode
    // rejects auto-injected `vite/modulepreload-polyfill` source phase
    // import with "must be external" error in CI builds. We're packaging
    // for Electron (recent Chromium), so polyfill for older browsers is
    // unnecessary anyway. Confirmed broken in v5.0.3.23 CI on all 3
    // desktop platforms.
    modulePreload: { polyfill: false },
    // 🚀 性能优化：代码分割和压缩
    rollupOptions: {
      output: {
        // 手动分块：将大型库分离到独立的 chunk
        manualChunks: {
          monaco: ["monaco-editor"],
          // echarts 已优化为按需导入，无需单独分块
          editor: [
            "@milkdown/core",
            "@milkdown/preset-commonmark",
            "@milkdown/preset-gfm",
          ],
          codemirror: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/lang-javascript",
            "@codemirror/lang-css",
            "@codemirror/lang-html",
          ],
          "vue-vendor": ["vue", "vue-router", "pinia"],
          // ant-design-vue 已通过 unplugin-vue-components 按需导入，无需手动分块
        },
        // 优化 chunk 文件名
        chunkFileNames: "assets/js/[name]-[hash].js",
        entryFileNames: "assets/js/[name]-[hash].js",
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]",
      },
    },
    // 设置 chunk 大小警告限制（1MB）
    chunkSizeWarningLimit: 1000,
    // 使用 terser 进行代码压缩
    minify: "terser",
    terserOptions: {
      compress: {
        // 生产环境移除 console 和 debugger
        drop_console: true, // 始终移除console（生产构建时）
        drop_debugger: true,
        pure_funcs: [
          "console.log",
          "console.info",
          "console.debug",
          "console.warn",
        ],
      },
      format: {
        // 移除注释
        comments: false,
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 生成 sourcemap（开发环境）
    sourcemap: process.env.NODE_ENV !== "production",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
    // Add parent node_modules to resolve path for workspace dependencies
    preserveSymlinks: false,
    dedupe: ["vue", "vue-router", "pinia"],
    extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json", ".vue"],
  },
  optimizeDeps: {
    include: ["monaco-editor"],
    // echarts 已优化为按需导入，无需预构建
    // ant-design-vue 组件已按需导入，无需预构建
    exclude: [],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
