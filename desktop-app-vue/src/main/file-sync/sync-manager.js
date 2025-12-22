const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chokidar = require('chokidar');

/**
 * 文件同步管理器
 * 负责数据库与文件系统之间的双向同步
 */
class FileSyncManager extends EventEmitter {
  constructor(database, mainWindow) {
    super();
    this.database = database;
    this.mainWindow = mainWindow;
    this.watchers = new Map(); // projectId → chokidar watcher
    this.syncLocks = new Map(); // fileId → lock state
  }

  /**
   * 计算内容的 SHA256 哈希
   */
  calculateHash(content) {
    return crypto.createHash('sha256').update(content || '', 'utf8').digest('hex');
  }

  /**
   * 检查路径是否为本地文件系统路径
   */
  isLocalPath(filePath) {
    if (!filePath) return false;

    // Windows 路径 (C:\... 或 D:\... 等)
    if (/^[a-zA-Z]:[/\\]/.test(filePath)) return true;

    // Unix 路径 (/ 开头但不是 /data/projects/)
    if (filePath.startsWith('/') && !filePath.startsWith('/data/projects/')) return true;

    return false;
  }

  /**
   * 保存文件（双向同步：数据库 + 文件系统）
   * @param {string} fileId - 文件 ID
   * @param {string} content - 文件内容
   * @param {string} projectId - 项目 ID
   */
  async saveFile(fileId, content, projectId) {
    // 防止循环触发
    if (this.syncLocks.get(fileId)) {
      console.log(`[FileSyncManager] 文件 ${fileId} 正在同步中，跳过`);
      return;
    }

    this.syncLocks.set(fileId, true);

    try {
      console.log(`[FileSyncManager] 开始保存文件 ${fileId}`);

      // 1. 获取文件信息
      const file = this.database.db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);
      if (!file) {
        throw new Error(`文件不存在: ${fileId}`);
      }

      // 2. 计算内容哈希
      const contentHash = this.calculateHash(content);
      console.log(`[FileSyncManager] 内容哈希: ${contentHash}`);

      // 3. 更新数据库
      this.database.db.run(
        `UPDATE project_files SET content = ?, content_hash = ?, updated_at = ?, file_size = ? WHERE id = ?`,
        [content, contentHash, Date.now(), Buffer.byteLength(content || '', 'utf8'), fileId]
      );

      // 4. 获取项目信息
      const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);

      // 5. 写入文件系统（如果有本地路径）
      if (project?.root_path && this.isLocalPath(project.root_path)) {
        const fsPath = path.join(project.root_path, file.file_path);
        console.log(`[FileSyncManager] 写入文件系统: ${fsPath}`);

        // 确保目录存在
        await fs.promises.mkdir(path.dirname(fsPath), { recursive: true });

        // 写入文件
        await fs.promises.writeFile(fsPath, content || '', 'utf8');

        // 更新 fs_path
        this.database.db.run('UPDATE project_files SET fs_path = ? WHERE id = ?', [fsPath, fileId]);
      }

      // 6. 更新同步状态
      this.database.db.run(
        `INSERT OR REPLACE INTO file_sync_state
         (file_id, fs_hash, db_hash, last_synced_at, sync_direction)
         VALUES (?, ?, ?, ?, 'bidirectional')`,
        [fileId, contentHash, contentHash, Date.now()]
      );

      // 7. 保存数据库
      this.database.saveToFile();

      console.log(`[FileSyncManager] 文件保存成功: ${fileId}`);
      this.emit('file-synced', { fileId, contentHash });

      return { success: true, fileId, contentHash };

    } catch (error) {
      console.error(`[FileSyncManager] 保存文件失败:`, error);
      throw error;
    } finally {
      this.syncLocks.delete(fileId);
    }
  }

  /**
   * 从文件系统读取文件并更新到数据库
   * @param {string} projectId - 项目 ID
   * @param {string} relativePath - 相对路径
   */
  async syncFromFilesystem(projectId, relativePath) {
    console.log(`[FileSyncManager] 从文件系统同步: ${relativePath}`);

    try {
      // 1. 获取项目信息
      const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path || !this.isLocalPath(project.root_path)) {
        console.log('[FileSyncManager] 项目没有本地路径，跳过同步');
        return;
      }

      const fsPath = path.join(project.root_path, relativePath);

      // 2. 读取文件内容
      const content = await fs.promises.readFile(fsPath, 'utf8');
      const contentHash = this.calculateHash(content);

      // 3. 查找数据库中的文件
      const file = this.database.db.prepare(
        `SELECT * FROM project_files WHERE project_id = ? AND file_path = ?`
      ).get(projectId, relativePath);

      if (!file) {
        console.log('[FileSyncManager] 数据库中没有该文件记录');
        return;
      }

      // 4. 检查同步状态
      const syncState = this.database.db.prepare(
        'SELECT * FROM file_sync_state WHERE file_id = ?'
      ).get(file.id);

      // 5. 检测冲突（数据库和文件系统都被修改）
      if (syncState && syncState.db_hash !== syncState.fs_hash && file.content_hash !== syncState.db_hash) {
        console.warn('[FileSyncManager] 检测到同步冲突');
        this.emit('sync-conflict', {
          fileId: file.id,
          fsContent: content,
          dbContent: file.content
        });
        return;
      }

      // 6. 更新数据库
      this.database.db.run(
        `UPDATE project_files SET content = ?, content_hash = ?, updated_at = ?, file_size = ? WHERE id = ?`,
        [content, contentHash, Date.now(), Buffer.byteLength(content, 'utf8'), file.id]
      );

      // 7. 更新同步状态
      this.database.db.run(
        `INSERT OR REPLACE INTO file_sync_state
         (file_id, fs_hash, db_hash, last_synced_at, sync_direction)
         VALUES (?, ?, ?, ?, 'fs_to_db')`,
        [file.id, contentHash, contentHash, Date.now()]
      );

      // 8. 保存数据库
      this.database.saveToFile();

      console.log(`[FileSyncManager] 文件同步成功: ${file.id}`);
      this.emit('file-reloaded', { fileId: file.id, content });

      return { success: true, fileId: file.id, content };

    } catch (error) {
      console.error(`[FileSyncManager] 同步失败:`, error);
      throw error;
    }
  }

  /**
   * 解决文件冲突
   * @param {string} fileId - 文件 ID
   * @param {string} resolution - 解决方式: 'use-db' | 'use-fs' | 'manual'
   * @param {string} manualContent - 手动合并的内容（当 resolution 为 'manual' 时）
   */
  async resolveConflict(fileId, resolution, manualContent = null) {
    console.log(`[FileSyncManager] 解决冲突: ${fileId}, 方式: ${resolution}`);

    try {
      const file = this.database.db.prepare('SELECT * FROM project_files WHERE id = ?').get(fileId);
      if (!file) throw new Error('文件不存在');

      const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(file.project_id);

      let finalContent = null;

      if (resolution === 'use-db') {
        // 使用数据库版本
        finalContent = file.content;
      } else if (resolution === 'use-fs') {
        // 使用文件系统版本
        if (project?.root_path && file.fs_path) {
          finalContent = await fs.promises.readFile(file.fs_path, 'utf8');
        } else {
          throw new Error('文件系统路径不存在');
        }
      } else if (resolution === 'manual') {
        // 使用手动合并的内容
        finalContent = manualContent;
      } else {
        throw new Error('无效的解决方式');
      }

      // 保存最终内容
      await this.saveFile(fileId, finalContent, file.project_id);

      // 清除冲突标记
      this.database.db.run(
        'UPDATE file_sync_state SET conflict_detected = 0 WHERE file_id = ?',
        [fileId]
      );
      this.database.saveToFile();

      console.log(`[FileSyncManager] 冲突解决成功`);
      this.emit('conflict-resolved', { fileId, resolution });

      return { success: true };

    } catch (error) {
      console.error(`[FileSyncManager] 解决冲突失败:`, error);
      throw error;
    }
  }

  /**
   * 刷新所有项目文件的更改到文件系统
   * @param {string} projectId - 项目 ID
   */
  async flushAllChanges(projectId) {
    console.log(`[FileSyncManager] 刷新项目所有更改: ${projectId}`);

    try {
      const project = this.database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path || !this.isLocalPath(project.root_path)) {
        console.log('[FileSyncManager] 项目没有本地路径，跳过刷新');
        return;
      }

      const files = this.database.db.prepare('SELECT * FROM project_files WHERE project_id = ?').all(projectId);

      for (const file of files) {
        const fsPath = path.join(project.root_path, file.file_path);

        // 确保目录存在
        await fs.promises.mkdir(path.dirname(fsPath), { recursive: true });

        // 写入文件
        await fs.promises.writeFile(fsPath, file.content || '', 'utf8');

        console.log(`[FileSyncManager] 刷新文件: ${fsPath}`);
      }

      console.log(`[FileSyncManager] 所有更改已刷新到文件系统`);
      return { success: true, count: files.length };

    } catch (error) {
      console.error(`[FileSyncManager] 刷新失败:`, error);
      throw error;
    }
  }

  /**
   * 监听项目文件变化
   * @param {string} projectId - 项目 ID
   * @param {string} rootPath - 项目根路径
   */
  async watchProject(projectId, rootPath) {
    // 如果已经在监听，先停止
    if (this.watchers.has(projectId)) {
      this.stopWatch(projectId);
    }

    if (!rootPath || !this.isLocalPath(rootPath)) {
      console.log('[FileSyncManager] 项目没有本地路径，跳过监听');
      return;
    }

    console.log(`[FileSyncManager] 开始监听项目: ${projectId}, 路径: ${rootPath}`);

    const watcher = chokidar.watch(rootPath, {
      ignored: /(^|[\/\\])\.|node_modules|\.git|dist|build|out/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    watcher.on('change', async (fsPath) => {
      try {
        const relativePath = path.relative(rootPath, fsPath);
        console.log(`[FileSyncManager] 检测到文件变化: ${relativePath}`);

        // 防止同步循环
        const file = this.database.db.prepare(
          `SELECT * FROM project_files WHERE project_id = ? AND file_path = ?`
        ).get(projectId, relativePath);

        if (!file) {
          console.log(`[FileSyncManager] 数据库中没有该文件记录: ${relativePath}`);
          return;
        }

        // 检查是否正在同步
        if (this.syncLocks.get(file.id)) {
          console.log(`[FileSyncManager] 文件正在同步，跳过: ${file.id}`);
          return;
        }

        // 读取文件内容
        const content = await fs.promises.readFile(fsPath, 'utf8');
        const contentHash = this.calculateHash(content);

        // 检查同步状态
        const syncState = this.database.db.prepare(
          'SELECT * FROM file_sync_state WHERE file_id = ?'
        ).get(file.id);

        // 检测冲突（数据库和文件系统都被修改）
        if (syncState && syncState.db_hash !== syncState.fs_hash && file.content_hash !== syncState.db_hash) {
          console.warn(`[FileSyncManager] 检测到同步冲突: ${file.id}`);

          // 标记冲突
          this.database.db.run(
            'UPDATE file_sync_state SET conflict_detected = 1 WHERE file_id = ?',
            [file.id]
          );
          this.database.saveToFile();

          // 通知前端
          this.emit('sync-conflict', {
            fileId: file.id,
            fileName: file.file_name,
            fsContent: content,
            dbContent: file.content
          });

          if (this.mainWindow) {
            this.mainWindow.webContents.send('file-sync:conflict', {
              fileId: file.id,
              fileName: file.file_name
            });
          }
          return;
        }

        // 更新数据库
        this.database.db.run(
          `UPDATE project_files SET content = ?, content_hash = ?, updated_at = ?, file_size = ? WHERE id = ?`,
          [content, contentHash, Date.now(), Buffer.byteLength(content, 'utf8'), file.id]
        );

        // 更新同步状态
        this.database.db.run(
          `INSERT OR REPLACE INTO file_sync_state
           (file_id, fs_hash, db_hash, last_synced_at, sync_direction)
           VALUES (?, ?, ?, ?, 'fs_to_db')`,
          [file.id, contentHash, contentHash, Date.now()]
        );

        this.database.saveToFile();

        console.log(`[FileSyncManager] 文件同步成功: ${file.id}`);

        // 通知前端刷新
        if (this.mainWindow) {
          this.mainWindow.webContents.send('file-sync:reloaded', {
            fileId: file.id,
            content
          });
        }

      } catch (error) {
        console.error(`[FileSyncManager] 文件监听处理失败:`, error);
      }
    });

    watcher.on('add', async (fsPath) => {
      try {
        const relativePath = path.relative(rootPath, fsPath);
        console.log(`[FileSyncManager] 检测到新文件: ${relativePath}`);

        // 检查数据库中是否已存在
        const existingFile = this.database.db.prepare(
          `SELECT id FROM project_files WHERE project_id = ? AND file_path = ?`
        ).get(projectId, relativePath);

        if (existingFile) {
          console.log(`[FileSyncManager] 文件已存在于数据库: ${relativePath}`);
          return;
        }

        // 读取文件内容
        const content = await fs.promises.readFile(fsPath, 'utf8');
        const stats = await fs.promises.stat(fsPath);
        const contentHash = this.calculateHash(content);

        // 确定文件类型
        const fileExt = path.extname(relativePath).substring(1);
        const fileType = this.getFileType(fileExt);

        // 插入数据库
        const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        this.database.db.run(
          `INSERT INTO project_files
           (id, project_id, file_name, file_path, file_type, content, content_hash, file_size, fs_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId,
            projectId,
            path.basename(relativePath),
            relativePath,
            fileType,
            content,
            contentHash,
            stats.size,
            fsPath,
            Date.now(),
            Date.now()
          ]
        );

        // 添加同步状态
        this.database.db.run(
          `INSERT INTO file_sync_state
           (file_id, fs_hash, db_hash, last_synced_at, sync_direction)
           VALUES (?, ?, ?, ?, 'fs_to_db')`,
          [fileId, contentHash, contentHash, Date.now()]
        );

        this.database.saveToFile();

        console.log(`[FileSyncManager] 新文件已添加到数据库: ${fileId}`);

        // 通知前端
        if (this.mainWindow) {
          this.mainWindow.webContents.send('file-sync:file-added', {
            fileId,
            projectId,
            relativePath
          });
        }

      } catch (error) {
        console.error(`[FileSyncManager] 新文件处理失败:`, error);
      }
    });

    watcher.on('unlink', async (fsPath) => {
      try {
        const relativePath = path.relative(rootPath, fsPath);
        console.log(`[FileSyncManager] 检测到文件删除: ${relativePath}`);

        const file = this.database.db.prepare(
          `SELECT id FROM project_files WHERE project_id = ? AND file_path = ?`
        ).get(projectId, relativePath);

        if (!file) {
          console.log(`[FileSyncManager] 数据库中没有该文件记录: ${relativePath}`);
          return;
        }

        // 从数据库删除
        this.database.db.run('DELETE FROM project_files WHERE id = ?', [file.id]);
        this.database.db.run('DELETE FROM file_sync_state WHERE file_id = ?', [file.id]);
        this.database.saveToFile();

        console.log(`[FileSyncManager] 文件已从数据库删除: ${file.id}`);

        // 通知前端
        if (this.mainWindow) {
          this.mainWindow.webContents.send('file-sync:file-deleted', {
            fileId: file.id,
            projectId,
            relativePath
          });
        }

      } catch (error) {
        console.error(`[FileSyncManager] 文件删除处理失败:`, error);
      }
    });

    watcher.on('error', (error) => {
      console.error(`[FileSyncManager] 文件监听错误:`, error);
    });

    this.watchers.set(projectId, watcher);
    console.log(`[FileSyncManager] 项目监听已启动: ${projectId}`);

    return { success: true, projectId };
  }

  /**
   * 获取文件类型
   * @param {string} ext - 文件扩展名
   */
  getFileType(ext) {
    const typeMap = {
      js: 'code',
      ts: 'code',
      jsx: 'code',
      tsx: 'code',
      vue: 'code',
      py: 'code',
      java: 'code',
      go: 'code',
      rs: 'code',
      html: 'code',
      css: 'code',
      scss: 'code',
      md: 'document',
      txt: 'document',
      json: 'data',
      xml: 'data',
      yaml: 'data',
      yml: 'data',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image'
    };
    return typeMap[ext] || 'other';
  }

  /**
   * 停止监听项目
   * @param {string} projectId - 项目 ID
   */
  stopWatch(projectId) {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectId);
      console.log(`[FileSyncManager] 停止监听项目: ${projectId}`);
    }
  }

  /**
   * 停止所有监听
   */
  stopAll() {
    for (const [projectId, watcher] of this.watchers.entries()) {
      watcher.close();
      console.log(`[FileSyncManager] 停止监听项目: ${projectId}`);
    }
    this.watchers.clear();
  }
}

module.exports = FileSyncManager;
