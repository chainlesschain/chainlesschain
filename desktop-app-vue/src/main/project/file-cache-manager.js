const { logger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');

/**
 * 文件缓存管理器
 * 使用数据库作为缓存，文件系统监听增量更新
 * 解决大型项目文件列表加载性能问题
 */
class FileCacheManager {
  constructor(database) {
    this.database = database;
    this.watchers = new Map(); // projectId -> watcher
    this.scanQueue = new Map(); // projectId -> scan promise
  }

  /**
   * 获取项目文件列表（优化版本）
   * @param {string} projectId - 项目ID
   * @param {Object} options - 选项
   * @param {number} options.offset - 偏移量
   * @param {number} options.limit - 限制数量
   * @param {string} options.fileType - 文件类型过滤
   * @param {string} options.parentPath - 父路径（懒加载）
   * @param {boolean} options.forceRefresh - 强制刷新
   * @returns {Promise<Object>} { files, total, hasMore }
   */
  async getFiles(projectId, options = {}) {
    const {
      offset = 0,
      limit = 100,
      fileType = null,
      parentPath = null,
      forceRefresh = false
    } = options;

    try {
      // 1. 获取项目信息
      const project = this.database.db
        .prepare('SELECT * FROM projects WHERE id = ?')
        .get(projectId);

      if (!project) {
        throw new Error('项目不存在');
      }

      const rootPath = project.root_path || project.folder_path;
      if (!rootPath) {
        return { files: [], total: 0, hasMore: false };
      }

      // 2. 检查缓存状态
      const cacheStatus = await this.getCacheStatus(projectId);

      // 3. 如果缓存为空或强制刷新，启动后台扫描
      if (cacheStatus.isEmpty || forceRefresh) {
        this.scheduleBackgroundScan(projectId, rootPath);
      }

      // 4. 从数据库缓存读取（快速返回）
      const result = await this.getFromCache(projectId, {
        offset,
        limit,
        fileType,
        parentPath
      });

      // 5. 启动文件监听（如果尚未启动）
      if (!this.watchers.has(projectId)) {
        this.startFileWatcher(projectId, rootPath);
      }

      return result;
    } catch (error) {
      logger.error('[FileCacheManager] 获取文件失败:', error);
      throw error;
    }
  }

  /**
   * 从数据库缓存读取文件
   * @private
   */
  async getFromCache(projectId, options) {
    const { offset, limit, fileType, parentPath } = options;

    // 构建查询
    let query = 'SELECT * FROM project_files WHERE project_id = ? AND deleted = 0';
    const params = [projectId];

    // 文件类型过滤
    if (fileType) {
      query += ' AND file_type = ?';
      params.push(fileType);
    }

    // 父路径过滤（懒加载）
    if (parentPath !== null) {
      if (parentPath === '' || parentPath === '/') {
        // 根目录：只返回顶层文件
        query += ' AND (file_path NOT LIKE ? OR file_path = ?)';
        params.push('%/%', '');
      } else {
        // 子目录：返回直接子项
        const escapedPath = parentPath.replace(/[%_]/g, '\\$&');
        query += ' AND file_path LIKE ? AND file_path NOT LIKE ?';
        params.push(`${escapedPath}/%`, `${escapedPath}/%/%`);
      }
    }

    // 排序
    query += ' ORDER BY is_folder DESC, file_name ASC';

    // 获取总数
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const countResult = this.database.db.prepare(countQuery).get(...params);
    const total = countResult?.count || 0;

    // 分页查询
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.database.db.prepare(query);
    const files = stmt.all(...params);

    return {
      files,
      total,
      hasMore: offset + limit < total,
      fromCache: true
    };
  }

  /**
   * 获取缓存状态
   * @private
   */
  async getCacheStatus(projectId) {
    const result = this.database.db
      .prepare('SELECT COUNT(*) as count FROM project_files WHERE project_id = ? AND deleted = 0')
      .get(projectId);

    return {
      isEmpty: result.count === 0,
      fileCount: result.count,
      lastUpdated: Date.now()
    };
  }

  /**
   * 调度后台扫描
   * @private
   */
  scheduleBackgroundScan(projectId, rootPath) {
    // 如果已经在扫描中，跳过
    if (this.scanQueue.has(projectId)) {
      logger.info('[FileCacheManager] 扫描已在进行中:', projectId);
      return this.scanQueue.get(projectId);
    }

    logger.info('[FileCacheManager] 启动后台扫描:', projectId);

    const scanPromise = this.scanAndCacheFiles(projectId, rootPath)
      .finally(() => {
        this.scanQueue.delete(projectId);
      });

    this.scanQueue.set(projectId, scanPromise);
    return scanPromise;
  }

  /**
   * 扫描文件系统并缓存到数据库
   * @private
   */
  async scanAndCacheFiles(projectId, rootPath) {
    const startTime = Date.now();
    let scannedCount = 0;

    try {
      // 检查目录是否存在
      try {
        await fs.access(rootPath);
      } catch (error) {
        logger.error('[FileCacheManager] 项目目录不存在:', rootPath);
        return;
      }

      const files = [];

      // 递归扫描
      async function scanDirectory(dirPath, relativePath = '') {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            // 跳过隐藏文件和特定目录
            if (/(^|[/\\])\.|node_modules|\.git|dist|build|out/.test(entry.name)) {
              continue;
            }

            const fullPath = path.join(dirPath, entry.name);
            const fileRelativePath = relativePath
              ? path.join(relativePath, entry.name)
              : entry.name;
            const isFolder = entry.isDirectory();

            try {
              const stats = await fs.stat(fullPath);

              const fileInfo = {
                id: 'file_' + crypto.randomUUID(),
                project_id: projectId,
                file_name: entry.name,
                file_path: fileRelativePath.replace(/\\/g, '/'),
                file_type: isFolder
                  ? 'folder'
                  : path.extname(entry.name).substring(1) || 'file',
                is_folder: isFolder ? 1 : 0,
                file_size: stats.size || 0,
                created_at: Math.floor(stats.birthtimeMs || Date.now()),
                updated_at: Math.floor(stats.mtimeMs || Date.now()),
                sync_status: 'synced',
                deleted: 0,
                version: 1,
              };

              files.push(fileInfo);
              scannedCount++;

              // 每100个文件保存一次
              if (files.length >= 100) {
                await saveBatch(files.splice(0, 100));
              }

              if (isFolder) {
                await scanDirectory(fullPath, fileRelativePath);
              }
            } catch (statError) {
              logger.error('[FileCacheManager] 无法读取文件状态:', statError);
            }
          }
        } catch (readError) {
          logger.error('[FileCacheManager] 无法读取目录:', readError);
        }
      }

      // 批量保存到数据库
      const saveBatch = async (batch) => {
        const stmt = this.database.db.prepare(`
          INSERT OR REPLACE INTO project_files (
            id, project_id, file_name, file_path, file_type, is_folder,
            file_size, created_at, updated_at, sync_status, deleted, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.database.transaction(() => {
          for (const file of batch) {
            stmt.run(
              file.id,
              file.project_id,
              file.file_name,
              file.file_path,
              file.file_type,
              file.is_folder,
              file.file_size,
              file.created_at,
              file.updated_at,
              file.sync_status,
              file.deleted,
              file.version
            );
          }
        })();
      };

      // 扫描所有文件
      await scanDirectory(rootPath);

      // 保存剩余文件
      if (files.length > 0) {
        await saveBatch(files);
      }

      const duration = Date.now() - startTime;
      logger.info(
        `[FileCacheManager] 扫描完成: ${scannedCount} 个文件, 耗时 ${duration}ms`
      );
    } catch (error) {
      logger.error('[FileCacheManager] 扫描失败:', error);
    }
  }

  /**
   * 启动文件监听
   * @private
   */
  startFileWatcher(projectId, rootPath) {
    if (this.watchers.has(projectId)) {
      return;
    }

    logger.info('[FileCacheManager] 启动文件监听:', projectId);

    const watcher = chokidar.watch(rootPath, {
      ignored: /(^|[/\\])\.|node_modules|\.git|dist|build|out/,
      persistent: true,
      ignoreInitial: true, // 不触发初始扫描
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    });

    // 文件添加
    watcher.on('add', async (filePath) => {
      await this.handleFileAdded(projectId, rootPath, filePath);
    });

    // 文件修改
    watcher.on('change', async (filePath) => {
      await this.handleFileChanged(projectId, rootPath, filePath);
    });

    // 文件删除
    watcher.on('unlink', async (filePath) => {
      await this.handleFileDeleted(projectId, rootPath, filePath);
    });

    // 目录添加
    watcher.on('addDir', async (dirPath) => {
      await this.handleDirectoryAdded(projectId, rootPath, dirPath);
    });

    // 目录删除
    watcher.on('unlinkDir', async (dirPath) => {
      await this.handleDirectoryDeleted(projectId, rootPath, dirPath);
    });

    this.watchers.set(projectId, watcher);
  }

  /**
   * 处理文件添加
   * @private
   */
  async handleFileAdded(projectId, rootPath, filePath) {
    try {
      const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
      const stats = await fs.stat(filePath);

      const fileInfo = {
        id: 'file_' + crypto.randomUUID(),
        project_id: projectId,
        file_name: path.basename(filePath),
        file_path: relativePath,
        file_type: path.extname(filePath).substring(1) || 'file',
        is_folder: 0,
        file_size: stats.size,
        created_at: Math.floor(stats.birthtimeMs || Date.now()),
        updated_at: Math.floor(stats.mtimeMs || Date.now()),
        sync_status: 'pending',
        deleted: 0,
        version: 1
      };

      const stmt = this.database.db.prepare(`
        INSERT OR REPLACE INTO project_files (
          id, project_id, file_name, file_path, file_type, is_folder,
          file_size, created_at, updated_at, sync_status, deleted, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        fileInfo.id,
        fileInfo.project_id,
        fileInfo.file_name,
        fileInfo.file_path,
        fileInfo.file_type,
        fileInfo.is_folder,
        fileInfo.file_size,
        fileInfo.created_at,
        fileInfo.updated_at,
        fileInfo.sync_status,
        fileInfo.deleted,
        fileInfo.version
      );

      logger.info('[FileCacheManager] 文件已添加到缓存:', relativePath);
    } catch (error) {
      logger.error('[FileCacheManager] 处理文件添加失败:', error);
    }
  }

  /**
   * 处理文件修改
   * @private
   */
  async handleFileChanged(projectId, rootPath, filePath) {
    try {
      const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');
      const stats = await fs.stat(filePath);

      const stmt = this.database.db.prepare(`
        UPDATE project_files
        SET file_size = ?, updated_at = ?, sync_status = 'pending'
        WHERE project_id = ? AND file_path = ?
      `);

      stmt.run(stats.size, Math.floor(stats.mtimeMs || Date.now()), projectId, relativePath);

      logger.info('[FileCacheManager] 文件已更新:', relativePath);
    } catch (error) {
      logger.error('[FileCacheManager] 处理文件修改失败:', error);
    }
  }

  /**
   * 处理文件删除
   * @private
   */
  async handleFileDeleted(projectId, rootPath, filePath) {
    try {
      const relativePath = path.relative(rootPath, filePath).replace(/\\/g, '/');

      const stmt = this.database.db.prepare(`
        UPDATE project_files
        SET deleted = 1, updated_at = ?, sync_status = 'pending'
        WHERE project_id = ? AND file_path = ?
      `);

      stmt.run(Date.now(), projectId, relativePath);

      logger.info('[FileCacheManager] 文件已标记删除:', relativePath);
    } catch (error) {
      logger.error('[FileCacheManager] 处理文件删除失败:', error);
    }
  }

  /**
   * 处理目录添加
   * @private
   */
  async handleDirectoryAdded(projectId, rootPath, dirPath) {
    try {
      const relativePath = path.relative(rootPath, dirPath).replace(/\\/g, '/');
      const stats = await fs.stat(dirPath);

      const fileInfo = {
        id: 'file_' + crypto.randomUUID(),
        project_id: projectId,
        file_name: path.basename(dirPath),
        file_path: relativePath,
        file_type: 'folder',
        is_folder: 1,
        file_size: 0,
        created_at: Math.floor(stats.birthtimeMs || Date.now()),
        updated_at: Math.floor(stats.mtimeMs || Date.now()),
        sync_status: 'pending',
        deleted: 0,
        version: 1
      };

      const stmt = this.database.db.prepare(`
        INSERT OR REPLACE INTO project_files (
          id, project_id, file_name, file_path, file_type, is_folder,
          file_size, created_at, updated_at, sync_status, deleted, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        fileInfo.id,
        fileInfo.project_id,
        fileInfo.file_name,
        fileInfo.file_path,
        fileInfo.file_type,
        fileInfo.is_folder,
        fileInfo.file_size,
        fileInfo.created_at,
        fileInfo.updated_at,
        fileInfo.sync_status,
        fileInfo.deleted,
        fileInfo.version
      );

      logger.info('[FileCacheManager] 目录已添加到缓存:', relativePath);
    } catch (error) {
      logger.error('[FileCacheManager] 处理目录添加失败:', error);
    }
  }

  /**
   * 处理目录删除
   * @private
   */
  async handleDirectoryDeleted(projectId, rootPath, dirPath) {
    try {
      const relativePath = path.relative(rootPath, dirPath).replace(/\\/g, '/');

      // 标记目录及其所有子文件为删除
      const stmt = this.database.db.prepare(`
        UPDATE project_files
        SET deleted = 1, updated_at = ?, sync_status = 'pending'
        WHERE project_id = ? AND (file_path = ? OR file_path LIKE ?)
      `);

      stmt.run(Date.now(), projectId, relativePath, `${relativePath}/%`);

      logger.info('[FileCacheManager] 目录及子文件已标记删除:', relativePath);
    } catch (error) {
      logger.error('[FileCacheManager] 处理目录删除失败:', error);
    }
  }

  /**
   * 停止文件监听
   */
  async stopFileWatcher(projectId) {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(projectId);
      logger.info('[FileCacheManager] 已停止文件监听:', projectId);
    }
  }

  /**
   * 清理缓存
   */
  async clearCache(projectId) {
    const stmt = this.database.db.prepare(
      'DELETE FROM project_files WHERE project_id = ?'
    );
    stmt.run(projectId);
    logger.info('[FileCacheManager] 已清理缓存:', projectId);
  }

  /**
   * 销毁管理器
   */
  async destroy() {
    for (const [projectId, watcher] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
    this.scanQueue.clear();
  }
}

module.exports = FileCacheManager;
