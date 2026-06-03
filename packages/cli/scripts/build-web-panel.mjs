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
  console.log("[build-web-panel] 安装依赖...");
  execSync("npm install --legacy-peer-deps", {
    cwd: WEB_PANEL_ROOT,
    stdio: "inherit",
    encoding: "utf-8",
  });
  console.log("[build-web-panel] 执行 vite build...");
  execSync("npm run build", {
    cwd: WEB_PANEL_ROOT,
    stdio: "inherit",
    encoding: "utf-8",
  });
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
