const path = require("path");

/**
 * 判断 resolvedPath 是否在 baseDir 目录内（含 baseDir 自身）。
 *
 * 用于路径遍历防护的目录边界判定。**必须按目录分隔符判边界**：裸的
 * `resolvedPath.startsWith(baseDir)` 会放过名字以 baseDir 为前缀的「兄弟目录」——
 * 例如 baseDir=".../plugins/foo" 时 ".../plugins/foo-evil/x" 也 startsWith 通过，
 * 造成沙箱/项目目录逃逸。这里要求 resolvedPath 等于 baseDir 或以 baseDir+分隔符
 * 开头，杜绝该前缀兄弟目录绕过。
 *
 * 两个入参都应是已 resolve/join 过的绝对路径；内部再 normalize 一次做防御。
 * 与现有检查保持一致，不做 realpath（符号链接逃逸是另一独立议题，不在此处处理）。
 *
 * @param {string} baseDir - 允许的基准目录（绝对路径）
 * @param {string} resolvedPath - 待判定的目标路径（已 resolve/join 的绝对路径）
 * @returns {boolean} resolvedPath 是否位于 baseDir 之内（或就是 baseDir）
 */
function isWithinDir(baseDir, resolvedPath) {
  if (typeof baseDir !== "string" || typeof resolvedPath !== "string") {
    return false;
  }
  const base = path.normalize(baseDir);
  const target = path.normalize(resolvedPath);
  if (target === base) {
    return true;
  }
  const boundary = base.endsWith(path.sep) ? base : base + path.sep;
  return target.startsWith(boundary);
}

module.exports = { isWithinDir };
