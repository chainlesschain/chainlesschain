/**
 * safe-open — 收口 shell.openExternal / shell.openPath 的输入校验，防止渲染层
 * 传入的不可信 URL/路径被直接交给系统打开。
 *
 * 背景（安全审计 2026-06-05）：多个 IPC 入口把渲染层可控的字符串直接喂给
 * `shell.openExternal(url)` / `shell.openPath(p)`：
 *   - openExternal 接受任意 scheme → `file://…exe` / `smb://` / 自定义协议
 *     可启动本地程序或泄露 SMB 凭据；
 *   - openPath 接受任意路径 → 执行任意可执行文件；`path.join(root, userInput)`
 *     可被 `../../` 逃逸出项目根。
 *
 * 本模块提供集中校验：
 *   - isSafeExternalUrl / safeOpenExternal：仅放行 http(s)。
 *   - isPathWithin：确认 target 落在 parent 目录内（防 `..` 逃逸）。
 *   - safeOpenPathDir：仅以文件管理器打开“存在且为目录”的路径（防执行文件）。
 *
 * 注入点（opts.openExternal / opts.openPath / opts.fs）便于单测，不依赖 electron。
 *
 * @module utils/safe-open
 */

const path = require("path");
const realFs = require("fs");
const { logger } = require("./logger.js");

/** 仅这些 scheme 允许交给 shell.openExternal。 */
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * @param {string} url
 * @returns {boolean} 是否为允许的外部 URL（http/https）。
 */
function isSafeExternalUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_e) {
    return false;
  }
  return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol);
}

/**
 * 校验后再 shell.openExternal；非 http(s) 一律拒绝并抛错。
 * @param {string} url
 * @param {{openExternal?: (u:string)=>Promise<any>}} [opts]
 */
async function safeOpenExternal(url, opts = {}) {
  if (!isSafeExternalUrl(url)) {
    logger.warn(
      `[safe-open] 拒绝打开非 http(s) 外部链接: ${String(url).slice(0, 120)}`,
    );
    throw new Error(
      `Refused to open external URL with disallowed scheme: ${String(url).slice(0, 60)}`,
    );
  }
  const open =
    opts.openExternal || ((u) => require("electron").shell.openExternal(u));
  return open(url);
}

/**
 * @param {string} parentDir
 * @param {string} targetPath
 * @returns {boolean} targetPath 是否落在 parentDir 内（含 parentDir 本身），防 `..` 逃逸。
 */
function isPathWithin(parentDir, targetPath) {
  if (
    typeof parentDir !== "string" ||
    typeof targetPath !== "string" ||
    !parentDir ||
    !targetPath
  ) {
    return false;
  }
  const rel = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  // 在内部：rel 为空（同一目录），或不以 `..` 开头且不是绝对路径（跨盘符）。
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 仅当路径“存在且为目录”时才用文件管理器打开（防把可执行文件交给 openPath 执行）。
 * @param {string} dirPath
 * @param {{openPath?: (p:string)=>Promise<any>, fs?: object}} [opts]
 */
async function safeOpenPathDir(dirPath, opts = {}) {
  const fs = opts.fs || realFs;
  let st;
  try {
    st = fs.statSync(dirPath);
  } catch (_e) {
    logger.warn(
      `[safe-open] 拒绝打开不存在的路径: ${String(dirPath).slice(0, 120)}`,
    );
    throw new Error("Refused to open a path that does not exist");
  }
  if (!st.isDirectory()) {
    logger.warn(
      `[safe-open] 拒绝以文件管理器打开非目录: ${String(dirPath).slice(0, 120)}`,
    );
    throw new Error("Refused to open a non-directory path in the file manager");
  }
  const open = opts.openPath || ((p) => require("electron").shell.openPath(p));
  return open(dirPath);
}

module.exports = {
  ALLOWED_EXTERNAL_PROTOCOLS,
  isSafeExternalUrl,
  safeOpenExternal,
  isPathWithin,
  safeOpenPathDir,
};
