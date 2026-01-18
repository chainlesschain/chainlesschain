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
        inlineDynamicImports: !isH5,
        // 资源文件命名
        assetFileNames: "static/[name].[hash][extname]",
        // 块文件命名
        chunkFileNames: "static/js/[name]-[hash].js",
        // 入口文件命名
        entryFileNames: "[name].js",
        // H5平台手动分包配置
        ...(isH5 && {
          manualChunks: {
            'vendor-vue': ['vue', 'pinia'],
            'vendor-crypto': ['crypto-js', 'tweetnacl', 'tweetnacl-util', 'bs58'],
            'vendor-ui': ['mp-html'],
          },
        }),
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
