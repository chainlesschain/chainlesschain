import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig(({ mode }) => {
  const isH5 = process.env.UNI_PLATFORM === 'h5';

  return {
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
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
      },
      mangle: {
        safari10: true,
      },
    },
    // 资源内联阈值
    assetsInlineLimit: 4096,
    // 块大小警告阈值（降低以便更早发现问题）
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // H5平台启用代码分割，小程序和App保持内联
        // 注意：不使用manualChunks以避免与uni-app构建系统冲突
        inlineDynamicImports: !isH5,
        assetFileNames: "static/[name].[hash][extname]",
        chunkFileNames: "static/js/[name]-[hash].js",
        entryFileNames: "[name].js",
      },
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
    ],
    exclude: ['highlight.js'], // 延迟加载，不预构建
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
  };
});
