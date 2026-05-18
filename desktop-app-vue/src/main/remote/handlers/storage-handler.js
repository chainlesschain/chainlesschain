/**
 * 存储信息远程处理器
 *
 * 处理来自 Android 端的存储相关命令：
 * - storage.getDisks: 获取磁盘列表 (PUBLIC)
 * - storage.getUsage: 获取存储使用情况 (PUBLIC)
 * - storage.getPartitions: 获取分区信息 (PUBLIC)
 * - storage.getStats: 获取文件系统统计 (NORMAL)
 * - storage.getFolderSize: 获取文件夹大小 (NORMAL)
 * - storage.getLargeFiles: 查找大文件 (NORMAL)
 * - storage.getRecentFiles: 获取最近文件 (NORMAL)
 * - storage.cleanup: 清理临时文件 (ADMIN)
 * - storage.emptyTrash: 清空回收站 (ADMIN)
 *
 * @module remote/handlers/storage-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 验证路径安全性（防止路径遍历攻击）
 * @param {string} inputPath - 输入路径
 * @returns {boolean} 是否安全
 */
function isValidPath(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return false;
  }

  // 禁止路径遍历
  if (inputPath.includes("..")) {
    return false;
  }

  // 限制长度
  if (inputPath.length > 500) {
    return false;
  }

  // Windows: 禁止危险字符
  if (isWindows) {
    const dangerousChars = /[<>"|?*]/;
    if (dangerousChars.test(inputPath)) {
      return false;
    }
  }

  return true;
}

/**
 * 存储信息处理器类
 */
class StorageHandler {
  constructor(options = {}) {
    this.options = {
      maxScanDepth: options.maxScanDepth || 5,
      maxFilesToReturn: options.maxFilesToReturn || 100,
      tempDirs: options.tempDirs || this._getDefaultTempDirs(),
      ...options,
    };

    logger.info("[StorageHandler] 存储信息处理器已创建");
  }

  /**
   * 获取默认临时目录
   */
  _getDefaultTempDirs() {
    const dirs = [os.tmpdir()];

    if (isWindows) {
      dirs.push(
        path.join(os.homedir(), "AppData", "Local", "Temp"),
        "C:\\Windows\\Temp",
      );
    } else {
      dirs.push("/tmp", "/var/tmp");
    }

    return dirs;
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[StorageHandler] 处理命令: ${action}`);

    switch (action) {
      case "getDisks":
        return await this.getDisks(params, context);

      case "getUsage":
        return await this.getUsage(params, context);

      case "getPartitions":
        return await this.getPartitions(params, context);

      case "getStats":
        return await this.getStats(params, context);

      case "getFolderSize":
        return await this.getFolderSize(params, context);

      case "getLargeFiles":
        return await this.getLargeFiles(params, context);

      case "getRecentFiles":
        return await this.getRecentFiles(params, context);

      case "cleanup":
        return await this.cleanupTempFiles(params, context);

      case "emptyTrash":
        return await this.emptyTrash(params, context);

      case "getDriveHealth":
        return await this.getDriveHealth(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取磁盘列表
   */
  async getDisks(params = {}, context) {
    logger.debug(`[StorageHandler] 获取磁盘列表`);

    try {
      let disks = [];

      if (isWindows) {
        disks = await this._getWindowsDisks();
      } else if (isMac) {
        disks = await this._getMacDisks();
      } else if (isLinux) {
        disks = await this._getLinuxDisks();
      }

      return {
        success: true,
        disks,
        total: disks.length,
      };
    } catch (error) {
      logger.error("[StorageHandler] 获取磁盘列表失败:", error);
      throw new Error(`Failed to get disks: ${error.message}`);
    }
  }

  async _getWindowsDisks() {
    try {
      const { stdout } = await execAsync(
        "wmic logicaldisk get DeviceID,Size,FreeSpace,FileSystem,VolumeName,DriveType /format:csv",
      );

      const lines = stdout.trim().split("\n").filter(Boolean).slice(1);
      const disks = [];

      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length >= 6) {
          const deviceId = parts[1]?.trim();
          const driveType = parseInt(parts[2]) || 0;
          const fileSystem = parts[3]?.trim();
          const freeSpace = parseInt(parts[4]) || 0;
          const size = parseInt(parts[5]) || 0;
          const volumeName = parts[6]?.trim();

          if (deviceId && size > 0) {
            disks.push({
              name: deviceId,
              label: volumeName || deviceId,
              fileSystem: fileSystem || "Unknown",
              type: this._getDriveTypeName(driveType),
              size,
              free: freeSpace,
              used: size - freeSpace,
              usagePercent:
                Math.round(((size - freeSpace) / size) * 100 * 100) / 100,
              sizeFormatted: this._formatBytes(size),
              freeFormatted: this._formatBytes(freeSpace),
              usedFormatted: this._formatBytes(size - freeSpace),
            });
          }
        }
      }

      return disks;
    } catch (error) {
      logger.error("[StorageHandler] Windows 磁盘获取失败:", error);
      return [];
    }
  }

  _getDriveTypeName(type) {
    const types = {
      0: "Unknown",
      1: "No Root",
      2: "Removable",
      3: "Local",
      4: "Network",
      5: "CD-ROM",
      6: "RAM Disk",
    };
    return types[type] || "Unknown";
  }

  async _getMacDisks() {
    try {
      const { stdout } = await execAsync("df -h");
      const lines = stdout.trim().split("\n").slice(1);
      const disks = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6) {
          const filesystem = parts[0];
          const size = this._parseSize(parts[1]);
          const used = this._parseSize(parts[2]);
          const free = this._parseSize(parts[3]);
          const usagePercent = parseInt(parts[4]) || 0;
          const mountPoint = parts[5];

          // 过滤系统分区
          if (
            mountPoint &&
            !mountPoint.startsWith("/System") &&
            !mountPoint.startsWith("/private")
          ) {
            disks.push({
              name: filesystem,
              mountPoint,
              size,
              free,
              used,
              usagePercent,
              sizeFormatted: this._formatBytes(size),
              freeFormatted: this._formatBytes(free),
              usedFormatted: this._formatBytes(used),
            });
          }
        }
      }

      return disks;
    } catch (error) {
      logger.error("[StorageHandler] Mac 磁盘获取失败:", error);
      return [];
    }
  }

  async _getLinuxDisks() {
    try {
      const { stdout } = await execAsync(
        "df -B1 --output=source,fstype,size,used,avail,pcent,target 2>/dev/null || df -h",
      );
      const lines = stdout.trim().split("\n").slice(1);
      const disks = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 7) {
          const source = parts[0];
          const fsType = parts[1];
          const size = parseInt(parts[2]) || 0;
          const used = parseInt(parts[3]) || 0;
          const free = parseInt(parts[4]) || 0;
          const usagePercent = parseInt(parts[5]) || 0;
          const mountPoint = parts[6];

          // 过滤虚拟文件系统
          if (source.startsWith("/dev/") && size > 0) {
            disks.push({
              name: source,
              mountPoint,
              fileSystem: fsType,
              size,
              free,
              used,
              usagePercent,
              sizeFormatted: this._formatBytes(size),
              freeFormatted: this._formatBytes(free),
              usedFormatted: this._formatBytes(used),
            });
          }
        }
      }

      return disks;
    } catch (error) {
      logger.error("[StorageHandler] Linux 磁盘获取失败:", error);
      return [];
    }
  }

  /**
   * 获取存储使用情况摘要
   */
  async getUsage(params = {}, context) {
    logger.debug(`[StorageHandler] 获取存储使用情况`);

    try {
      const { disks } = await this.getDisks({}, context);

      let totalSize = 0;
      let totalUsed = 0;
      let totalFree = 0;

      for (const disk of disks) {
        if (disk.type !== "Network" && disk.type !== "CD-ROM") {
          totalSize += disk.size || 0;
          totalUsed += disk.used || 0;
          totalFree += disk.free || 0;
        }
      }

      return {
        success: true,
        usage: {
          total: totalSize,
          used: totalUsed,
          free: totalFree,
          usagePercent:
            totalSize > 0
              ? Math.round((totalUsed / totalSize) * 100 * 100) / 100
              : 0,
          totalFormatted: this._formatBytes(totalSize),
          usedFormatted: this._formatBytes(totalUsed),
          freeFormatted: this._formatBytes(totalFree),
          diskCount: disks.length,
        },
      };
    } catch (error) {
      logger.error("[StorageHandler] 获取存储使用情况失败:", error);
      throw new Error(`Failed to get usage: ${error.message}`);
    }
  }

  /**
   * 获取分区信息
   */
  async getPartitions(params = {}, context) {
    logger.debug(`[StorageHandler] 获取分区信息`);

    try {
      let partitions = [];

      if (isWindows) {
        partitions = await this._getWindowsPartitions();
      } else {
        partitions = await this._getUnixPartitions();
      }

      return {
        success: true,
        partitions,
        total: partitions.length,
      };
    } catch (error) {
      logger.error("[StorageHandler] 获取分区信息失败:", error);
      throw new Error(`Failed to get partitions: ${error.message}`);
    }
  }

  async _getWindowsPartitions() {
    try {
      const { stdout } = await execAsync(
        "wmic partition get BlockSize,Name,Size,Type /format:csv",
      );

      const lines = stdout.trim().split("\n").filter(Boolean).slice(1);
      const partitions = [];

      for (const line of lines) {
        const parts = line.split(",");
        if (parts.length >= 4) {
          partitions.push({
            name: parts[2]?.trim(),
            size: parseInt(parts[3]) || 0,
            type: parts[4]?.trim(),
            blockSize: parseInt(parts[1]) || 0,
          });
        }
      }

      return partitions;
    } catch {
      return [];
    }
  }

  async _getUnixPartitions() {
    try {
      const { stdout } = await execAsync(
        "lsblk -b -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,UUID 2>/dev/null || diskutil list",
      );
      const lines = stdout.trim().split("\n").slice(1);
      const partitions = [];

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          partitions.push({
            name: parts[0],
            size: parseInt(parts[1]) || 0,
            type: parts[2],
            fileSystem: parts[3] || null,
            mountPoint: parts[4] || null,
            uuid: parts[5] || null,
          });
        }
      }

      return partitions;
    } catch {
      return [];
    }
  }

  /**
   * 获取文件系统统计信息
   */
  async getStats(params = {}, context) {
    const { targetPath = os.homedir() } = params;

    if (!isValidPath(targetPath)) {
      throw new Error("Invalid path format");
    }

    logger.debug(`[StorageHandler] 获取文件系统统计: ${targetPath}`);

    try {
      const stats = await fs.stat(targetPath);
      let fileCount = 0;
      let dirCount = 0;
      let totalSize = 0;

      if (stats.isDirectory()) {
        const result = await this._countFilesRecursive(targetPath, 2);
        fileCount = result.files;
        dirCount = result.dirs;
        totalSize = result.size;
      } else {
        fileCount = 1;
        totalSize = stats.size;
      }

      return {
        success: true,
        stats: {
          path: targetPath,
          isDirectory: stats.isDirectory(),
          fileCount,
          dirCount,
          totalSize,
          totalSizeFormatted: this._formatBytes(totalSize),
          createdAt: stats.birthtime?.toISOString(),
          modifiedAt: stats.mtime?.toISOString(),
          accessedAt: stats.atime?.toISOString(),
        },
      };
    } catch (error) {
      logger.error(`[StorageHandler] 获取统计失败: ${targetPath}`, error);
      throw new Error(`Failed to get stats: ${error.message}`);
    }
  }

  async _countFilesRecursive(dirPath, maxDepth, currentDepth = 0) {
    let files = 0;
    let dirs = 0;
    let size = 0;

    if (currentDepth >= maxDepth) {
      return { files, dirs, size };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            dirs++;
            const subResult = await this._countFilesRecursive(
              fullPath,
              maxDepth,
              currentDepth + 1,
            );
            files += subResult.files;
            dirs += subResult.dirs;
            size += subResult.size;
          } else if (entry.isFile()) {
            files++;
            const stat = await fs.stat(fullPath);
            size += stat.size;
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 跳过无法访问的目录
    }

    return { files, dirs, size };
  }

  /**
   * 获取文件夹大小
   */
  async getFolderSize(params, context) {
    const { folderPath } = params;

    if (!folderPath) {
      throw new Error('Parameter "folderPath" is required');
    }

    if (!isValidPath(folderPath)) {
      throw new Error("Invalid path format");
    }

    logger.debug(`[StorageHandler] 获取文件夹大小: ${folderPath}`);

    try {
      let size = 0;

      if (isWindows) {
        try {
          const { stdout } = await execAsync(
            `powershell -command "(Get-ChildItem -Path '${folderPath}' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
            { timeout: 60000 },
          );
          size = parseInt(stdout.trim()) || 0;
        } catch {
          // 回退到递归计算
          const result = await this._countFilesRecursive(folderPath, 10);
          size = result.size;
        }
      } else {
        try {
          const { stdout } = await execAsync(
            `du -sb "${folderPath}" 2>/dev/null | cut -f1`,
            {
              timeout: 60000,
            },
          );
          size = parseInt(stdout.trim()) || 0;
        } catch {
          const result = await this._countFilesRecursive(folderPath, 10);
          size = result.size;
        }
      }

      return {
        success: true,
        folderPath,
        size,
        sizeFormatted: this._formatBytes(size),
      };
    } catch (error) {
      logger.error(`[StorageHandler] 获取文件夹大小失败: ${folderPath}`, error);
      throw new Error(`Failed to get folder size: ${error.message}`);
    }
  }

  /**
   * 查找大文件
   */
  async getLargeFiles(params, context) {
    const {
      searchPath = os.homedir(),
      minSize = 100 * 1024 * 1024, // 100 MB
      limit = 20,
    } = params;

    if (!isValidPath(searchPath)) {
      throw new Error("Invalid path format");
    }

    logger.info(
      `[StorageHandler] 查找大文件: ${searchPath} (>= ${this._formatBytes(minSize)})`,
    );

    try {
      const largeFiles = [];

      await this._findLargeFilesRecursive(searchPath, minSize, largeFiles, 3);

      // 按大小排序
      largeFiles.sort((a, b) => b.size - a.size);

      // 限制返回数量
      const limited = largeFiles.slice(0, limit);

      return {
        success: true,
        files: limited,
        total: largeFiles.length,
        returned: limited.length,
        minSize,
        minSizeFormatted: this._formatBytes(minSize),
      };
    } catch (error) {
      logger.error(`[StorageHandler] 查找大文件失败: ${searchPath}`, error);
      throw new Error(`Failed to find large files: ${error.message}`);
    }
  }

  async _findLargeFilesRecursive(
    dirPath,
    minSize,
    results,
    maxDepth,
    currentDepth = 0,
  ) {
    if (currentDepth >= maxDepth || results.length >= 100) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            await this._findLargeFilesRecursive(
              fullPath,
              minSize,
              results,
              maxDepth,
              currentDepth + 1,
            );
          } else if (entry.isFile()) {
            const stat = await fs.stat(fullPath);
            if (stat.size >= minSize) {
              results.push({
                path: fullPath,
                name: entry.name,
                size: stat.size,
                sizeFormatted: this._formatBytes(stat.size),
                modifiedAt: stat.mtime?.toISOString(),
              });
            }
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  /**
   * 获取最近修改的文件
   */
  async getRecentFiles(params, context) {
    const { searchPath = os.homedir(), days = 7, limit = 50 } = params;

    if (!isValidPath(searchPath)) {
      throw new Error("Invalid path format");
    }

    logger.debug(`[StorageHandler] 获取最近文件: ${searchPath} (${days} 天内)`);

    try {
      const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
      const recentFiles = [];

      await this._findRecentFilesRecursive(
        searchPath,
        cutoffTime,
        recentFiles,
        3,
      );

      // 按修改时间排序
      recentFiles.sort((a, b) => b.modifiedTime - a.modifiedTime);

      // 限制返回数量
      const limited = recentFiles.slice(0, limit);

      return {
        success: true,
        files: limited,
        total: recentFiles.length,
        returned: limited.length,
        days,
      };
    } catch (error) {
      logger.error(`[StorageHandler] 获取最近文件失败: ${searchPath}`, error);
      throw new Error(`Failed to get recent files: ${error.message}`);
    }
  }

  async _findRecentFilesRecursive(
    dirPath,
    cutoffTime,
    results,
    maxDepth,
    currentDepth = 0,
  ) {
    if (currentDepth >= maxDepth || results.length >= 200) {
      return;
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            await this._findRecentFilesRecursive(
              fullPath,
              cutoffTime,
              results,
              maxDepth,
              currentDepth + 1,
            );
          } else if (entry.isFile()) {
            const stat = await fs.stat(fullPath);
            if (stat.mtime.getTime() >= cutoffTime) {
              results.push({
                path: fullPath,
                name: entry.name,
                size: stat.size,
                sizeFormatted: this._formatBytes(stat.size),
                modifiedAt: stat.mtime?.toISOString(),
                modifiedTime: stat.mtime.getTime(),
              });
            }
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  /**
   * 清理临时文件
   */
  async cleanupTempFiles(params, context) {
    const { dryRun = true, maxAge = 7 } = params;

    logger.info(
      `[StorageHandler] 清理临时文件 (dryRun: ${dryRun}, maxAge: ${maxAge} 天)`,
    );

    try {
      const cutoffTime = Date.now() - maxAge * 24 * 60 * 60 * 1000;
      let totalSize = 0;
      let fileCount = 0;
      const cleanedFiles = [];

      for (const tempDir of this.options.tempDirs) {
        try {
          await fs.access(tempDir);
          const result = await this._cleanupDirectory(
            tempDir,
            cutoffTime,
            dryRun,
          );
          totalSize += result.size;
          fileCount += result.count;
          cleanedFiles.push(...result.files);
        } catch {
          // 目录不存在或无权限
        }
      }

      return {
        success: true,
        dryRun,
        maxAge,
        cleaned: {
          fileCount,
          totalSize,
          totalSizeFormatted: this._formatBytes(totalSize),
          files: cleanedFiles.slice(0, 50), // 只返回前 50 个
        },
      };
    } catch (error) {
      logger.error("[StorageHandler] 清理临时文件失败:", error);
      throw new Error(`Failed to cleanup: ${error.message}`);
    }
  }

  async _cleanupDirectory(dirPath, cutoffTime, dryRun) {
    let size = 0;
    let count = 0;
    const files = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          const fullPath = path.join(dirPath, entry.name);
          const stat = await fs.stat(fullPath);

          if (entry.isFile() && stat.mtime.getTime() < cutoffTime) {
            size += stat.size;
            count++;
            files.push({
              path: fullPath,
              size: stat.size,
            });

            if (!dryRun) {
              await fs.unlink(fullPath);
            }
          }
        } catch {
          // 跳过无法访问的文件
        }
      }
    } catch {
      // 跳过无法访问的目录
    }

    return { size, count, files };
  }

  /**
   * 清空回收站
   */
  async emptyTrash(params, context) {
    const { dryRun = true } = params;

    logger.info(`[StorageHandler] 清空回收站 (dryRun: ${dryRun})`);

    try {
      let result = { success: false, message: "" };

      if (isWindows) {
        if (!dryRun) {
          await execAsync(
            'powershell -command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue"',
          );
        }
        result = {
          success: true,
          message: dryRun ? "Would empty Recycle Bin" : "Recycle Bin emptied",
        };
      } else if (isMac) {
        const trashPath = path.join(os.homedir(), ".Trash");
        if (!dryRun) {
          await execAsync(`rm -rf "${trashPath}"/*`);
        }
        result = {
          success: true,
          message: dryRun ? "Would empty Trash" : "Trash emptied",
        };
      } else if (isLinux) {
        const trashPaths = [
          path.join(os.homedir(), ".local/share/Trash/files"),
          path.join(os.homedir(), ".local/share/Trash/info"),
        ];
        if (!dryRun) {
          for (const p of trashPaths) {
            await execAsync(`rm -rf "${p}"/*`).catch(() => {});
          }
        }
        result = {
          success: true,
          message: dryRun ? "Would empty Trash" : "Trash emptied",
        };
      }

      return {
        success: true,
        dryRun,
        ...result,
      };
    } catch (error) {
      logger.error("[StorageHandler] 清空回收站失败:", error);
      throw new Error(`Failed to empty trash: ${error.message}`);
    }
  }

  /**
   * 获取驱动器健康状态（仅支持部分平台）
   */
  async getDriveHealth(params = {}, context) {
    logger.debug(`[StorageHandler] 获取驱动器健康状态`);

    try {
      const health = [];

      if (isWindows) {
        try {
          const { stdout } = await execAsync(
            "wmic diskdrive get Model,Status,Size,MediaType /format:csv",
          );

          const lines = stdout.trim().split("\n").filter(Boolean).slice(1);
          for (const line of lines) {
            const parts = line.split(",");
            if (parts.length >= 4) {
              health.push({
                model: parts[2]?.trim(),
                mediaType: parts[1]?.trim(),
                size: parseInt(parts[3]) || 0,
                status: parts[4]?.trim() || "Unknown",
              });
            }
          }
        } catch {
          // WMIC 可能不可用
        }
      } else if (isLinux) {
        try {
          // 尝试读取 SMART 信息
          const { stdout } = await execAsync(
            "lsblk -d -o NAME,MODEL,SIZE,ROTA,STATE 2>/dev/null",
          );
          const lines = stdout.trim().split("\n").slice(1);

          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 4) {
              health.push({
                name: parts[0],
                model: parts[1] || "Unknown",
                size: parts[2],
                rotational: parts[3] === "1",
                state: parts[4] || "running",
              });
            }
          }
        } catch {
          // lsblk 可能不可用
        }
      }

      return {
        success: true,
        drives: health,
        total: health.length,
      };
    } catch (error) {
      logger.error("[StorageHandler] 获取驱动器健康状态失败:", error);
      return {
        success: true,
        drives: [],
        error: error.message,
      };
    }
  }

  /**
   * 格式化字节数
   */
  _formatBytes(bytes) {
    if (!bytes || bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * 解析大小字符串
   */
  _parseSize(sizeStr) {
    if (!sizeStr) {
      return 0;
    }

    const units = {
      B: 1,
      K: 1024,
      KB: 1024,
      M: 1024 * 1024,
      MB: 1024 * 1024,
      G: 1024 * 1024 * 1024,
      GB: 1024 * 1024 * 1024,
      T: 1024 * 1024 * 1024 * 1024,
      TB: 1024 * 1024 * 1024 * 1024,
    };

    const match = sizeStr.match(/^([\d.]+)\s*([A-Za-z]+)?$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = (match[2] || "B").toUpperCase();
      return Math.round(value * (units[unit] || 1));
    }

    return parseInt(sizeStr) || 0;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[StorageHandler] 资源已清理");
  }
}

module.exports = { StorageHandler };
