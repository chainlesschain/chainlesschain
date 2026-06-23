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
 * 允许交给 child_process.spawn 直接执行（不经 shell）的程序扩展名。
 * 故意不含 .bat/.cmd —— 批处理在无 shell 时本就无法被 spawn 执行，且经 shell 执行
 * 等价于命令注入。POSIX 下另放行带可执行位的无扩展名文件（见 isExecutableProgramPath）。
 */
const ALLOWED_PROGRAM_EXTENSIONS = new Set([".exe", ".com", ".app", ".sh"]);

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

/**
 * 校验 programPath 是「可被 spawn 直接执行的真实程序文件」：
 *   - 必须是绝对路径（拒绝 `cmd`/`powershell`/`bash` 等裸命令名 —— 否则会经 PATH 解析执行）；
 *   - 必须存在且为普通文件；
 *   - Windows：扩展名须在 {@link ALLOWED_PROGRAM_EXTENSIONS} 内；
 *   - POSIX：扩展名在白名单内，或带任一可执行位（mode & 0o111）。
 * 用于 file:openWith / file:openWithProgram，阻止渲染层把任意可执行体喂给 spawn。
 * @param {string} programPath
 * @param {{fs?: object, platform?: string}} [opts]
 * @returns {boolean}
 */
function isExecutableProgramPath(programPath, opts = {}) {
  const fs = opts.fs || realFs;
  const platform = opts.platform || process.platform;
  // 按目标平台而非宿主 OS 解析路径：CI 在 POSIX runner 上跑 win32 用例时，
  // 宿主的 path.isAbsolute/extname 会错判 `C:\…`，故按 platform 选 win32/posix 实现。
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  if (typeof programPath !== "string" || !programPath) {
    return false;
  }
  if (!pathImpl.isAbsolute(programPath)) {
    return false; // 裸命令名会经 PATH 解析 → 拒绝
  }
  let st;
  try {
    st = fs.statSync(programPath);
  } catch (_e) {
    return false; // 不存在
  }
  if (!st.isFile()) {
    return false;
  }
  const ext = pathImpl.extname(programPath).toLowerCase();
  if (ALLOWED_PROGRAM_EXTENSIONS.has(ext)) {
    return true;
  }
  if (platform !== "win32") {
    // POSIX：无扩展名/其它扩展名但带可执行位即可
    return typeof st.mode === "number" && (st.mode & 0o111) !== 0;
  }
  return false;
}

/**
 * 在用指定程序打开文件前做集中校验；任一不合法即抛错（拒绝 spawn）。
 *   - programPath 须通过 {@link isExecutableProgramPath}；
 *   - fileArg 须为绝对路径且指向已存在的文件/目录（拒绝 `--flag`/`/c calc` 之类
 *     的参数注入 —— 它们不是真实路径）。
 * @param {string} programPath
 * @param {string} fileArg
 * @param {{fs?: object, platform?: string}} [opts]
 */
function assertSafeProgramOpen(programPath, fileArg, opts = {}) {
  const fs = opts.fs || realFs;
  const platform = opts.platform || process.platform;
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  if (!isExecutableProgramPath(programPath, opts)) {
    logger.warn(
      `[safe-open] 拒绝以非法/不可信程序打开文件: ${String(programPath).slice(0, 120)}`,
    );
    throw new Error("Refused to launch a disallowed or non-executable program");
  }
  if (
    typeof fileArg !== "string" ||
    !fileArg ||
    !pathImpl.isAbsolute(fileArg)
  ) {
    logger.warn(
      `[safe-open] 拒绝非绝对路径的打开目标: ${String(fileArg).slice(0, 120)}`,
    );
    throw new Error("Refused to open a non-absolute target path");
  }
  try {
    fs.statSync(fileArg);
  } catch (_e) {
    logger.warn(
      `[safe-open] 拒绝打开不存在的目标: ${String(fileArg).slice(0, 120)}`,
    );
    throw new Error("Refused to open a target path that does not exist");
  }
}

module.exports = {
  ALLOWED_EXTERNAL_PROTOCOLS,
  ALLOWED_PROGRAM_EXTENSIONS,
  isSafeExternalUrl,
  safeOpenExternal,
  isPathWithin,
  safeOpenPathDir,
  isExecutableProgramPath,
  assertSafeProgramOpen,
};
