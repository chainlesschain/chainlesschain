/**
 * 文件完整性检查和恢复工具
 * 提供文件损坏检测、校验和恢复机制
 */

const { logger, createLogger } = require('./logger.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

/**
 * 文件完整性检查器
 */
class FileIntegrityChecker extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      hashAlgorithm: options.hashAlgorithm || 'sha256',
      backupDir: options.backupDir || null,
      autoBackup: options.autoBackup !== false,
      maxBackups: options.maxBackups || 5,
      verifyOnRead: options.verifyOnRead !== false
    };

    this.checksumCache = new Map(); // 缓存文件校验和
  }

  /**
   * 计算文件哈希
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 文件哈希值
   */
  async calculateFileHash(filePath) {
    try {
      const content = await fs.readFile(filePath);
      const hash = crypto.createHash(this.options.hashAlgorithm);
      hash.update(content);
      return hash.digest('hex');
    } catch (error) {
      logger.error(`[FileIntegrity] 计算哈希失败 ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * 验证文件完整性
   * @param {string} filePath - 文件路径
   * @param {string} expectedHash - 预期哈希值
   * @returns {Promise<boolean>} 是否完整
   */
  async verifyFile(filePath, expectedHash) {
    try {
      const actualHash = await this.calculateFileHash(filePath);
      const isValid = actualHash === expectedHash;

      if (!isValid) {
        this.emit('corruption-detected', {
          filePath,
          expectedHash,
          actualHash
        });
      }

      return isValid;
    } catch (error) {
      logger.error(`[FileIntegrity] 验证文件失败 ${filePath}:`, error);
      return false;
    }
  }

  /**
   * 检查文件是否损坏（基于多种检测方法）
   * @param {string} filePath - 文件路径
   * @param {Object} options - 检查选项
   * @returns {Promise<Object>} 检查结果
   */
  async checkFile(filePath, options = {}) {
    const result = {
      filePath,
      exists: false,
      readable: false,
      corrupt: false,
      issues: [],
      metadata: null
    };

    try {
      // 1. 检查文件是否存在
      try {
        await fs.access(filePath, fs.constants.F_OK);
        result.exists = true;
      } catch {
        result.issues.push('文件不存在');
        return result;
      }

      // 2. 检查文件是否可读
      try {
        await fs.access(filePath, fs.constants.R_OK);
        result.readable = true;
      } catch {
        result.issues.push('文件不可读');
        result.corrupt = true;
        return result;
      }

      // 3. 获取文件元数据
      try {
        result.metadata = await fs.stat(filePath);

        // 检查文件大小
        if (result.metadata.size === 0 && options.allowEmpty !== true) {
          result.issues.push('文件为空');
          result.corrupt = true;
        }

        // 检查文件大小异常（如果提供了预期大小）
        if (options.expectedSize && Math.abs(result.metadata.size - options.expectedSize) > options.expectedSize * 0.1) {
          result.issues.push(`文件大小异常（预期: ${options.expectedSize}, 实际: ${result.metadata.size}）`);
          result.corrupt = true;
        }
      } catch (error) {
        result.issues.push(`无法获取文件元数据: ${error.message}`);
        result.corrupt = true;
        return result;
      }

      // 4. 尝试读取文件内容
      try {
        const content = await fs.readFile(filePath);

        // 检查魔数（文件签名）
        if (options.fileType) {
          const isValidType = this._validateFileType(content, options.fileType);
          if (!isValidType) {
            result.issues.push(`文件类型不匹配（预期: ${options.fileType}）`);
            result.corrupt = true;
          }
        }

        // 计算哈希（如果提供了预期哈希）
        if (options.expectedHash) {
          const hash = crypto.createHash(this.options.hashAlgorithm);
          hash.update(content);
          const actualHash = hash.digest('hex');

          if (actualHash !== options.expectedHash) {
            result.issues.push('文件校验和不匹配');
            result.corrupt = true;
          }
        }
      } catch (error) {
        result.issues.push(`读取文件失败: ${error.message}`);
        result.corrupt = true;
      }

      // 5. 对于特定文件类型，进行深度验证
      if (options.deepCheck && !result.corrupt) {
        const deepCheckResult = await this._deepCheckByType(filePath, options.fileType);
        if (!deepCheckResult.valid) {
          result.issues.push(...deepCheckResult.issues);
          result.corrupt = true;
        }
      }

    } catch (error) {
      result.issues.push(`检查过程出错: ${error.message}`);
      result.corrupt = true;
    }

    return result;
  }

  /**
   * 验证文件类型（通过魔数）
   * @param {Buffer} content - 文件内容
   * @param {string} fileType - 文件类型
   * @returns {boolean}
   */
  _validateFileType(content, fileType) {
    if (content.length < 4) {
      return false;
    }

    const signatures = {
      'png': [0x89, 0x50, 0x4E, 0x47],
      'jpg': [0xFF, 0xD8, 0xFF],
      'jpeg': [0xFF, 0xD8, 0xFF],
      'gif': [0x47, 0x49, 0x46],
      'pdf': [0x25, 0x50, 0x44, 0x46],
      'zip': [0x50, 0x4B, 0x03, 0x04],
      'sqlite': [0x53, 0x51, 0x4C, 0x69], // "SQLi"
      'db': [0x53, 0x51, 0x4C, 0x69]
    };

    const signature = signatures[fileType.toLowerCase()];
    if (!signature) {
      return true; // 未知类型，跳过验证
    }

    for (let i = 0; i < signature.length; i++) {
      if (content[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * 深度检查（针对特定文件类型）
   * @param {string} filePath - 文件路径
   * @param {string} fileType - 文件类型
   */
  async _deepCheckByType(filePath, fileType) {
    const result = {
      valid: true,
      issues: []
    };

    try {
      switch (fileType?.toLowerCase()) {
        case 'sqlite':
        case 'db':
          // SQLite 数据库完整性检查
          result.valid = await this._checkSQLiteIntegrity(filePath);
          if (!result.valid) {
            result.issues.push('SQLite 数据库完整性检查失败');
          }
          break;

        case 'json':
          // JSON 文件解析检查
          const jsonContent = await fs.readFile(filePath, 'utf8');
          try {
            JSON.parse(jsonContent);
          } catch {
            result.valid = false;
            result.issues.push('JSON 格式无效');
          }
          break;

        case 'png':
        case 'jpg':
        case 'jpeg':
          // 图片文件检查（使用 sharp 如果可用）
          try {
            const sharp = require('sharp');
            const metadata = await sharp(filePath).metadata();
            if (!metadata.width || !metadata.height) {
              result.valid = false;
              result.issues.push('图片元数据损坏');
            }
          } catch (error) {
            if (error.message.includes('Input buffer contains unsupported image format')) {
              result.valid = false;
              result.issues.push('图片格式损坏');
            }
          }
          break;
      }
    } catch (error) {
      result.valid = false;
      result.issues.push(`深度检查失败: ${error.message}`);
    }

    return result;
  }

  /**
   * 检查 SQLite 数据库完整性
   */
  async _checkSQLiteIntegrity(dbPath) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });

      try {
        const result = db.prepare('PRAGMA integrity_check').get();
        db.close();

        return result.integrity_check === 'ok';
      } catch (error) {
        db.close();
        return false;
      }
    } catch (error) {
      logger.error('[FileIntegrity] SQLite 检查失败:', error);
      return false;
    }
  }

  /**
   * 创建文件备份
   * @param {string} filePath - 源文件路径
   * @param {Object} options - 备份选项
   * @returns {Promise<string>} 备份文件路径
   */
  async createBackup(filePath, options = {}) {
    try {
      const backupDir = options.backupDir || this.options.backupDir || path.dirname(filePath);
      const fileName = path.basename(filePath);
      const timestamp = Date.now();
      const backupFileName = `${fileName}.backup.${timestamp}`;
      const backupPath = path.join(backupDir, backupFileName);

      // 确保备份目录存在
      await fs.mkdir(backupDir, { recursive: true });

      // 复制文件
      await fs.copyFile(filePath, backupPath);

      // 计算并保存校验和
      const hash = await this.calculateFileHash(backupPath);
      const checksumPath = `${backupPath}.checksum`;
      await fs.writeFile(checksumPath, hash, 'utf8');

      logger.info(`[FileIntegrity] 备份创建成功: ${backupPath}`);

      // 清理旧备份
      if (this.options.maxBackups > 0) {
        await this._cleanOldBackups(backupDir, fileName);
      }

      this.emit('backup-created', {
        originalPath: filePath,
        backupPath,
        hash
      });

      return backupPath;
    } catch (error) {
      logger.error('[FileIntegrity] 创建备份失败:', error);
      throw error;
    }
  }

  /**
   * 从备份恢复文件
   * @param {string} filePath - 目标文件路径
   * @param {string} backupPath - 备份文件路径（可选，自动查找最新备份）
   */
  async restoreFromBackup(filePath, backupPath = null) {
    try {
      let backupToUse = backupPath;

      // 如果未指定备份，查找最新的有效备份
      if (!backupToUse) {
        const backupDir = this.options.backupDir || path.dirname(filePath);
        const fileName = path.basename(filePath);
        backupToUse = await this._findLatestValidBackup(backupDir, fileName);

        if (!backupToUse) {
          throw new Error('未找到有效的备份文件');
        }
      }

      // 验证备份完整性
      const checksumPath = `${backupToUse}.checksum`;
      let isValid = true;

      try {
        const expectedHash = await fs.readFile(checksumPath, 'utf8');
        isValid = await this.verifyFile(backupToUse, expectedHash.trim());
      } catch {
        logger.warn('[FileIntegrity] 备份校验和文件不存在，跳过验证');
      }

      if (!isValid) {
        throw new Error('备份文件已损坏');
      }

      // 备份当前文件（如果存在）
      try {
        await fs.access(filePath);
        const corruptBackupPath = `${filePath}.corrupt.${Date.now()}`;
        await fs.copyFile(filePath, corruptBackupPath);
        logger.info(`[FileIntegrity] 损坏文件已备份至: ${corruptBackupPath}`);
      } catch {
        // 文件不存在，无需备份
      }

      // 恢复文件
      await fs.copyFile(backupToUse, filePath);

      logger.info(`[FileIntegrity] 文件已从备份恢复: ${backupToUse} -> ${filePath}`);

      this.emit('file-restored', {
        filePath,
        backupPath: backupToUse
      });

      return {
        success: true,
        backupUsed: backupToUse
      };
    } catch (error) {
      logger.error('[FileIntegrity] 恢复失败:', error);
      throw error;
    }
  }

  /**
   * 查找最新的有效备份
   */
  async _findLatestValidBackup(backupDir, fileName) {
    try {
      const files = await fs.readdir(backupDir);
      const backupPattern = new RegExp(`^${fileName}\\.backup\\.(\\d+)$`);

      const backups = files
        .filter(f => backupPattern.test(f))
        .map(f => ({
          name: f,
          timestamp: parseInt(f.match(backupPattern)[1]),
          path: path.join(backupDir, f)
        }))
        .sort((a, b) => b.timestamp - a.timestamp); // 按时间降序

      // 查找第一个有效的备份
      for (const backup of backups) {
        const checksumPath = `${backup.path}.checksum`;

        try {
          const expectedHash = await fs.readFile(checksumPath, 'utf8');
          const isValid = await this.verifyFile(backup.path, expectedHash.trim());

          if (isValid) {
            return backup.path;
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch (error) {
      logger.error('[FileIntegrity] 查找备份失败:', error);
      return null;
    }
  }

  /**
   * 清理旧备份
   */
  async _cleanOldBackups(backupDir, fileName) {
    try {
      const files = await fs.readdir(backupDir);
      const backupPattern = new RegExp(`^${fileName}\\.backup\\.(\\d+)(\\.checksum)?$`);

      const backups = files
        .filter(f => backupPattern.test(f) && !f.endsWith('.checksum'))
        .map(f => ({
          name: f,
          timestamp: parseInt(f.match(backupPattern)[1]),
          path: path.join(backupDir, f)
        }))
        .sort((a, b) => b.timestamp - a.timestamp);

      // 保留最新的 N 个备份
      const toDelete = backups.slice(this.options.maxBackups);

      for (const backup of toDelete) {
        await fs.unlink(backup.path);
        // 删除对应的校验和文件
        try {
          await fs.unlink(`${backup.path}.checksum`);
        } catch {}
        logger.info(`[FileIntegrity] 删除旧备份: ${backup.name}`);
      }
    } catch (error) {
      logger.error('[FileIntegrity] 清理备份失败:', error);
    }
  }
}

/**
 * 全局实例
 */
let globalChecker = null;

/**
 * 获取全局文件完整性检查器
 */
function getFileIntegrityChecker(options) {
  if (!globalChecker) {
    globalChecker = new FileIntegrityChecker(options);
  }
  return globalChecker;
}

module.exports = {
  FileIntegrityChecker,
  getFileIntegrityChecker
};
