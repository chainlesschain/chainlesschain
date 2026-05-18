/**
 * 文件工具函数
 */

/**
 * 递归复制目录
 * @param {string} source - 源目录路径
 * @param {string} destination - 目标目录路径
 */
async function copyDirectory(source, destination) {
  const fs = require('fs').promises;
  const path = require('path');

  // 确保目标目录存在
  await fs.mkdir(destination, { recursive: true });

  // 读取源目录内容
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      // 递归复制子目录
      await copyDirectory(sourcePath, destPath);
    } else {
      // 复制文件
      await fs.copyFile(sourcePath, destPath);
    }
  }
}

module.exports = {
  copyDirectory,
};
