import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { readFileSync } from "fs";

const rootPkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../package.json"), "utf-8"),
);

function manualChunks(id) {
  const normalizedId = id.replace(/\\/g, "/");

  if (!normalizedId.includes("/node_modules/")) return;

  if (
    normalizedId.includes("/vue/") ||
    normalizedId.includes("/vue-router/") ||
    normalizedId.includes("/pinia/")
  ) {
    return "vendor";
  }

  if (
    normalizedId.includes("/marked/") ||
    normalizedId.includes("/dompurify/") ||
    normalizedId.includes("/highlight.js/")
  ) {
    return "markdown";
  }

  if (
    normalizedId.includes("/@ant-design/icons-vue/") ||
    normalizedId.includes("/@ant-design/icons-svg/")
  ) {
    return "icons";
  }

  // Echarts is only consumed by KnowledgeGraph today, but bundling it
  // inline blew that route's chunk past Vite's 500 kB warning. Splitting
  // it out keeps the visited route lean and lets the browser cache the
  // (large, rarely-changing) charting bundle independently.
  if (
    normalizedId.includes("/echarts/") ||
    normalizedId.includes("/vue-echarts/") ||
    normalizedId.includes("/zrender/") ||
    normalizedId.includes("/tslib/")
  ) {
    return "echarts";
  }
}

export default defineConfig({
  plugins: [vue()],
  base: "./",
  define: {
    __PRODUCT_VERSION__: JSON.stringify(rootPkg.productVersion),
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    rollupOptions: {
      // Linux ARM64 hosted runners can expose a much lower open-file limit
      // than x64/macOS/Windows. Rollup's high default parallelism exhausted
      // that limit while loading the panel's asset graph. Keep the build
      // bounded without changing chunking or runtime output semantics.
      maxParallelFileOps: 64,
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(process.cwd(), "src"),
      // ant-design-vue imports this transitive package by name. Hosted Linux
      // npm installs have returned success while Vite still could not resolve
      // that import, so promote and pin it above and bind its public ESM file.
      "@ant-design/colors": resolve(
        process.cwd(),
        "node_modules/@ant-design/colors/dist/index.esm.js",
      ),
      // Keep vue-i18n's complete runtime chain deterministic across hosted
      // Linux runners. npm reports a successful locked install, but Rollup has
      // failed to resolve these nested conditional exports one at a time. Pin
      // the exact 9.14.5 chain and bind each package's public ESM file.
      "@intlify/core-base": resolve(
        process.cwd(),
        "node_modules/@intlify/core-base/dist/core-base.mjs",
      ),
      "@intlify/message-compiler": resolve(
        process.cwd(),
        "node_modules/@intlify/message-compiler/dist/message-compiler.mjs",
      ),
      "@intlify/shared": resolve(
        process.cwd(),
        "node_modules/@intlify/shared/dist/shared.mjs",
      ),
      // Shared i18n catalog (M1 of the i18n migration). web-panel is
      // not a workspace member, so we thread the seed in via alias
      // rather than a node_modules link. desktop-app-vue will mirror
      // this alias when it adopts the catalog.
      "@chainlesschain/locales": resolve(
        process.cwd(),
        "../locales/seed/index.js",
      ),
      "@chainlesschain/locales/zh-CN": resolve(
        process.cwd(),
        "../locales/seed/zh-CN.json",
      ),
      "@chainlesschain/locales/en": resolve(
        process.cwd(),
        "../locales/seed/en.json",
      ),
      // Agent SDK protocol contract (platform phase 3). Same non-workspace
      // threading as locales: alias straight to the TS source — Vite
      // compiles it, no build-order dependency on packages/agent-sdk/dist.
      "@chainlesschain/agent-sdk/browser": resolve(
        process.cwd(),
        "../agent-sdk/src/browser.ts",
      ),
    },
  },
});
