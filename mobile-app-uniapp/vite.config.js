import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

export default defineConfig(({ mode }) => {
  const isH5 = process.env.UNI_PLATFORM === 'h5';
  const isProduction = mode === 'production';

  const config = {
    plugins: [uni()],

    server: {
      port: 8080,
      host: "0.0.0.0",
      hmr: {
        overlay: true,
      },
    },

    build: {
      sourcemap: !isProduction,
      target: isH5 ? 'es2015' : 'esnext',
      minify: isProduction ? 'esbuild' : false,

      esbuildOptions: isProduction ? {
        drop: ['console', 'debugger'],
        legalComments: 'none',
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true,
      } : {},

      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 500,
      cssCodeSplit: isH5,
    },

    optimizeDeps: {
      include: [
        "vue",
        "pinia",
        "crypto-js",
        "tweetnacl",
        "tweetnacl-util",
        "bs58",
      ],
      exclude: ['highlight.js'],
      force: false,
    },

    resolve: {
      alias: {
        "@": "/src",
        "~": "/src",
        "@components": "/src/components",
        "@services": "/src/services",
        "@utils": "/src/utils",
        "@pages": "/src/pages",
        "@stores": "/src/stores",
      },
      extensions: ['.vue', '.js', '.json', '.mjs'],
    },

    css: {
      preprocessorOptions: {
        scss: {
          api: "modern-compiler",
          silenceDeprecations: ["legacy-js-api", "import"],
        },
      },
      modules: {
        localsConvention: 'camelCase',
      },
    },

    esbuild: {
      drop: isProduction ? ['console', 'debugger'] : [],
      pure: isProduction ? ['console.log', 'console.info', 'console.debug', 'console.warn'] : [],
    },

    cacheDir: 'node_modules/.vite',
    logLevel: isProduction ? 'warn' : 'info',
  };

  // 只为H5平台添加高级rollup配置
  if (isH5) {
    config.build.rollupOptions = {
      output: {
        assetFileNames: (assetInfo) => {
          if (/\.(png|jpe?g|svg|gif|webp|ico)$/i.test(assetInfo.name)) {
            return `static/images/[name]-[hash][extname]`;
          } else if (/\.(woff2?|eot|ttf|otf)$/i.test(assetInfo.name)) {
            return `static/fonts/[name]-[hash][extname]`;
          } else if (/\.css$/i.test(assetInfo.name)) {
            return `static/css/[name]-[hash][extname]`;
          }
          return `static/[ext]/[name]-[hash][extname]`;
        },
        chunkFileNames: "static/js/[name]-[hash].js",
        entryFileNames: "[name].js",
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('vue') || id.includes('pinia')) {
              return 'vendor-vue';
            }
            if (id.includes('crypto-js') || id.includes('tweetnacl')) {
              return 'vendor-crypto';
            }
            if (id.includes('highlight.js')) {
              return 'vendor-highlight';
            }
            if (id.includes('mp-html')) {
              return 'vendor-ui';
            }
            return 'vendor-common';
          }
        }
      },
      external: [],
    };
  }

  return config;
});
