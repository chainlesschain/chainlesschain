import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig({
  plugins: [uni()],
  server: {
    port: 8080,
    host: "0.0.0.0",
  },
  build: {
    // 启用源码映射（调试用，生产可关闭）
    sourcemap: false,
    // 压缩选项
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    // 资源内联阈值
    assetsInlineLimit: 4096,
    // 块大小警告阈值
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // uni-app IIFE 格式要求内联动态导入
        inlineDynamicImports: true,
        // 资源文件命名
        assetFileNames: "static/[name].[hash][extname]",
        // 入口文件命名
        entryFileNames: "[name].js",
      },
      // 外部依赖（uni-app 运行时已包含）
      external: [],
    },
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: [
      "vue",
      "pinia",
      "crypto-js",
      "tweetnacl",
      "tweetnacl-util",
      "bs58",
      "highlight.js",
    ],
  },
  // 解析配置
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  // CSS 预处理器配置
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
        silenceDeprecations: ["legacy-js-api", "import"],
      },
    },
  },
});
