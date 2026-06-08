#!/usr/bin/env node
/**
 * Build & bundle Web Panel into CLI assets, with hash-based skip.
 *
 * 优化计划 L2: 增量构建检测
 *   - 计算 web-panel/src 的内容哈希
 *   - 与 cli/src/assets/web-panel/.build-hash 比对
 *   - 命中即跳过，避免无变化重建（节省 npm publish 时 30~60s）
 *
 * 用法:
 *   node scripts/build-web-panel.mjs           # 智能模式
 *   node scripts/build-web-panel.mjs --force   # 强制重建
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "..");
const WEB_PANEL_ROOT = path.resolve(CLI_ROOT, "../web-panel");
const ASSETS_DIR = path.join(CLI_ROOT, "src/assets/web-panel");
const HASH_FILE = path.join(ASSETS_DIR, ".build-hash");

const FORCE = process.argv.includes("--force");

// 参与哈希计算的输入：源代码 + 构建配置 + 依赖锁
const HASH_INPUTS = [
  "src",
  "index.html",
  "vite.config.ts",
  "vite.config.js",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

function walk(dir, results = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, results);
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

function computeInputHash() {
  const hash = createHash("sha256");
  const files = [];
  for (const input of HASH_INPUTS) {
    const target = path.join(WEB_PANEL_ROOT, input);
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      files.push(...walk(target));
    } else {
      files.push(target);
    }
  }
  // 排序后哈希，确保跨平台稳定
  files.sort();
  for (const file of files) {
    const rel = path.relative(WEB_PANEL_ROOT, file).replace(/\\/g, "/");
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readPreviousHash() {
  try {
    return fs.readFileSync(HASH_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

function runBuild() {
  // web-panel is NOT a workspace member of the monorepo root (see root
  // package.json `workspaces`). Running `npm install` anywhere inside the repo
  // tree lets npm's workspace-root reconciliation absorb web-panel's deps — they
  // never land in packages/web-panel/node_modules, so vite's
  // findNearestNodeModules() walks up to <root>/node_modules and writes its
  // bundled-config temp file to <root>/node_modules/.vite-temp/, where the
  // web-panel-only devDep @vitejs/plugin-vue isn't resolvable → ERR_MODULE_NOT_FOUND.
  // That breaks `npm publish` (prepublishOnly → build:web-panel). Forcing
  // workspaces=false / installing at root both failed (npm keeps reconciling).
  //
  // The robust fix: build in an ISOLATED temp tree OUTSIDE the monorepo, with a
  // minimal root package.json that carries productVersion but NO `workspaces`,
  // plus the locales seed the config aliases. npm then installs locally and vite
  // resolves the toolchain from the temp web-panel/node_modules. Sources are
  // copied in and only dist/ is copied back.
  //
  // CRITICAL: this script runs INSIDE `npm publish` → `npm run build:web-panel`,
  // so the parent npm leaks npm_config_* env vars (notably npm_config_local_prefix
  // / npm_config_prefix pointing at the REAL monorepo). Inherited verbatim, the
  // child `npm install` ignores cwd and installs into the real repo root instead
  // of the temp dir — so the temp has no node_modules and vite can't resolve vite/
  // @vitejs/plugin-vue. We must scrub those vars so the child npm treats the temp
  // dir as its own project root. (This is why it worked when run standalone but
  // failed under `npm publish` in CI.)
  const childEnv = (() => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k.toLowerCase().startsWith("npm_config_")) delete env[k];
      if (k.toLowerCase().startsWith("npm_package_")) delete env[k];
    }
    delete env.npm_lifecycle_event;
    delete env.npm_lifecycle_script;
    delete env.npm_execpath;
    delete env.npm_command;
    delete env.npm_node_execpath;
    delete env.INIT_CWD;
    env.NODE_ENV = "development";
    return env;
  })();
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "cc-web-panel-"));
  const tmpRepo = path.join(tmpBase, "repo");
  const tmpWp = path.join(tmpRepo, "packages", "web-panel");
  try {
    fs.mkdirSync(tmpWp, { recursive: true });

    // 1. web-panel sources (skip node_modules/dist)
    fs.cpSync(WEB_PANEL_ROOT, tmpWp, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        return base !== "node_modules" && base !== "dist";
      },
    });

    // 2. minimal root package.json — carries productVersion (vite.config reads
    //    ../../package.json) but deliberately NO `workspaces` so npm installs
    //    web-panel locally instead of hoisting to this fake root.
    const rootPkg = JSON.parse(
      fs.readFileSync(path.resolve(CLI_ROOT, "../../package.json"), "utf-8"),
    );
    fs.writeFileSync(
      path.join(tmpRepo, "package.json"),
      JSON.stringify(
        {
          name: "cc-web-panel-build-root",
          private: true,
          productVersion: rootPkg.productVersion,
        },
        null,
        2,
      ),
    );

    // 3. locales seed — vite.config aliases @chainlesschain/locales → ../locales/seed
    const localesSeed = path.resolve(CLI_ROOT, "../locales/seed");
    if (fs.existsSync(localesSeed)) {
      const tmpSeed = path.join(tmpRepo, "packages", "locales", "seed");
      fs.mkdirSync(tmpSeed, { recursive: true });
      fs.cpSync(localesSeed, tmpSeed, { recursive: true });
    }

    console.log(`[build-web-panel] 隔离构建目录: ${tmpWp}`);
    console.log("[build-web-panel] 安装依赖 (scrubbed npm_config_* env)...");
    execSync("npm install --legacy-peer-deps", {
      cwd: tmpWp,
      stdio: "inherit",
      encoding: "utf-8",
      env: childEnv,
    });

    console.log("[build-web-panel] 执行 vite build...");
    execSync("npm run build", {
      cwd: tmpWp,
      stdio: "inherit",
      encoding: "utf-8",
      env: childEnv,
    });

    // copy the built dist/ back so copyDist() (reads WEB_PANEL_ROOT/dist) works
    const builtDist = path.join(tmpWp, "dist");
    if (!fs.existsSync(builtDist)) {
      throw new Error(`隔离构建未产出 dist: ${builtDist}`);
    }
    const targetDist = path.join(WEB_PANEL_ROOT, "dist");
    fs.rmSync(targetDist, { recursive: true, force: true });
    fs.cpSync(builtDist, targetDist, { recursive: true });
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
}

function copyDist() {
  const src = path.join(WEB_PANEL_ROOT, "dist");
  if (!fs.existsSync(src)) {
    throw new Error(`dist 目录不存在: ${src}`);
  }
  fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
  fs.cpSync(src, ASSETS_DIR, { recursive: true });
  console.log(`[build-web-panel] 已复制到 ${ASSETS_DIR}`);
}

function main() {
  if (!fs.existsSync(WEB_PANEL_ROOT)) {
    console.warn(
      `[build-web-panel] web-panel 目录不存在 (${WEB_PANEL_ROOT})，跳过`,
    );
    return;
  }

  const currentHash = computeInputHash();
  const previousHash = readPreviousHash();
  const distExists = fs.existsSync(ASSETS_DIR) && fs.existsSync(path.join(ASSETS_DIR, "index.html"));

  if (!FORCE && distExists && previousHash === currentHash) {
    console.log(
      `[build-web-panel] ✓ 输入未变化 (hash=${currentHash.slice(0, 12)}…)，跳过构建`,
    );
    return;
  }

  if (FORCE) console.log("[build-web-panel] --force 强制重建");
  else if (!distExists) console.log("[build-web-panel] 产物缺失，重新构建");
  else
    console.log(
      `[build-web-panel] 输入已变化 (${(previousHash || "无").slice(0, 12)}… → ${currentHash.slice(0, 12)}…)`,
    );

  runBuild();
  copyDist();
  fs.writeFileSync(HASH_FILE, currentHash + "\n", "utf-8");
  console.log(`[build-web-panel] ✓ 完成 (hash=${currentHash.slice(0, 12)}…)`);
}

main();
