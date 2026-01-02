/**
 * 文件操作 IPC
 * 处理文件的基础操作（读写、复制、移动、删除等）
 *
 * @module file-ipc
 * @description 文件操作模块，提供完整的文件系统操作功能
 */

const { ipcMain, shell, clipboard, dialog } = require('electron');
const path = require('path');

/**
 * 注册文件操作相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.getProjectConfig - 获取项目配置函数
 */
function registerFileIPC({
  database,
  mainWindow,
  getProjectConfig
}) {
  console.log('[File IPC] Registering File IPC handlers...');

  // ============================================================
  // 文件读写操作 (3 handlers)
  // ============================================================

  /**
   * 读取文件内容（文本文件）
   */
  ipcMain.handle('file:read-content', async (_event, filePath) => {
    try {
      const fs = require('fs').promises;

      // 解析路径
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(filePath);

      console.log('[Main] 读取文件内容:', resolvedPath);

      // 检查文件是否存在
      try {
        await fs.access(resolvedPath);
      } catch (error) {
        throw new Error(`文件不存在: ${resolvedPath}`);
      }

      // 读取文件内容
      const content = await fs.readFile(resolvedPath, 'utf-8');
      console.log('[Main] 文件读取成功，大小:', content.length, '字符');

      return content;
    } catch (error) {
      console.error('[Main] 读取文件内容失败:', error);
      throw error;
    }
  });

  /**
   * 写入文件内容（文本文件）
   */
  ipcMain.handle('file:write-content', async (_event, filePath, content) => {
    try {
      const fs = require('fs').promises;

      // 解析路径
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(filePath);

      console.log('[Main] 写入文件内容:', resolvedPath, '大小:', content?.length || 0, '字符');

      // 确保目录存在
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });

      // 写入文件
      await fs.writeFile(resolvedPath, content || '', 'utf-8');
      console.log('[Main] 文件写入成功');

      return { success: true };
    } catch (error) {
      console.error('[Main] 写入文件内容失败:', error);
      throw error;
    }
  });

  /**
   * 读取二进制文件内容（图片等）
   */
  ipcMain.handle('file:read-binary', async (_event, filePath) => {
    try {
      const fs = require('fs').promises;

      // 解析路径
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(filePath);

      console.log('[Main] 读取二进制文件:', resolvedPath);

      // 检查文件是否存在
      try {
        await fs.access(resolvedPath);
      } catch (error) {
        throw new Error(`文件不存在: ${resolvedPath}`);
      }

      // 读取二进制内容并转为base64
      const buffer = await fs.readFile(resolvedPath);
      const base64 = buffer.toString('base64');

      console.log('[Main] 二进制文件读取成功，大小:', buffer.length, '字节');

      return base64;
    } catch (error) {
      console.error('[Main] 读取二进制文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 文件管理操作 (8 handlers)
  // ============================================================

  /**
   * 在文件管理器中显示文件
   */
  ipcMain.handle('file:revealInExplorer', async (_event, { projectId, filePath }) => {
    try {
      const fs = require('fs');
      const projectConfig = getProjectConfig();

      console.log('[Main] 在文件管理器中显示:', filePath);

      // 获取项目根路径
      const rootPath = path.join(projectConfig.getProjectsRootPath(), projectId);
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 检查文件是否存在
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`文件不存在: ${resolvedPath}`);
      }

      // 使用 shell.showItemInFolder 在文件管理器中显示文件
      shell.showItemInFolder(path.normalize(resolvedPath));

      return { success: true, path: resolvedPath };
    } catch (error) {
      console.error('[Main] 在文件管理器中显示失败:', error);
      throw error;
    }
  });

  /**
   * 复制文件/文件夹
   */
  ipcMain.handle('file:copyItem', async (_event, { projectId, sourcePath, targetPath }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 复制文件:', { sourcePath, targetPath });

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedSourcePath = path.join(rootPath, sourcePath);
      const resolvedTargetPath = targetPath ? path.join(rootPath, targetPath, path.basename(sourcePath)) : resolvedSourcePath + '_copy';

      console.log('[Main] 源路径:', resolvedSourcePath);
      console.log('[Main] 目标路径:', resolvedTargetPath);

      // 递归复制函数
      async function copyRecursive(src, dest) {
        const stats = await fs.stat(src);

        if (stats.isDirectory()) {
          // 复制文件夹
          await fs.mkdir(dest, { recursive: true });
          const entries = await fs.readdir(src, { withFileTypes: true });

          for (const entry of entries) {
            await copyRecursive(
              path.join(src, entry.name),
              path.join(dest, entry.name)
            );
          }
        } else {
          // 复制文件
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(src, dest);
        }
      }

      await copyRecursive(resolvedSourcePath, resolvedTargetPath);

      console.log('[Main] 文件复制成功');

      const newTargetPath = path.relative(rootPath, resolvedTargetPath);

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'copied',
          sourcePath,
          targetPath: newTargetPath
        });
      }

      return { success: true, targetPath: newTargetPath };
    } catch (error) {
      console.error('[Main] 复制文件失败:', error);
      throw error;
    }
  });

  /**
   * 移动文件/文件夹（用于剪切粘贴）
   */
  ipcMain.handle('file:moveItem', async (_event, { projectId, sourcePath, targetPath }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 移动文件:', { sourcePath, targetPath });

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedSourcePath = path.join(rootPath, sourcePath);
      const resolvedTargetPath = path.join(rootPath, targetPath, path.basename(sourcePath));

      console.log('[Main] 源路径:', resolvedSourcePath);
      console.log('[Main] 目标路径:', resolvedTargetPath);

      // 确保目标目录存在
      await fs.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

      // 移动文件/文件夹
      await fs.rename(resolvedSourcePath, resolvedTargetPath);

      console.log('[Main] 文件移动成功');

      const newTargetPath = path.relative(rootPath, resolvedTargetPath);

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'moved',
          sourcePath,
          targetPath: newTargetPath
        });
      }

      return { success: true, targetPath: newTargetPath };
    } catch (error) {
      console.error('[Main] 移动文件失败:', error);
      throw error;
    }
  });

  /**
   * 删除文件/文件夹
   */
  ipcMain.handle('file:deleteItem', async (_event, { projectId, filePath }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 删除文件:', filePath);

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 递归删除函数
      async function deleteRecursive(targetPath) {
        const stats = await fs.stat(targetPath);

        if (stats.isDirectory()) {
          const entries = await fs.readdir(targetPath);
          for (const entry of entries) {
            await deleteRecursive(path.join(targetPath, entry));
          }
          await fs.rmdir(targetPath);
        } else {
          await fs.unlink(targetPath);
        }
      }

      await deleteRecursive(resolvedPath);

      console.log('[Main] 文件删除成功');

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'deleted',
          filePath
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[Main] 删除文件失败:', error);
      throw error;
    }
  });

  /**
   * 重命名文件/文件夹
   */
  ipcMain.handle('file:renameItem', async (_event, { projectId, oldPath, newName }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 重命名文件:', { oldPath, newName });

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedOldPath = path.join(rootPath, oldPath);
      const resolvedNewPath = path.join(path.dirname(resolvedOldPath), newName);

      console.log('[Main] 旧路径:', resolvedOldPath);
      console.log('[Main] 新路径:', resolvedNewPath);

      // 重命名文件/文件夹
      await fs.rename(resolvedOldPath, resolvedNewPath);

      console.log('[Main] 文件重命名成功');

      const newPath = path.relative(rootPath, resolvedNewPath);

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'renamed',
          oldPath,
          newPath
        });
      }

      return { success: true, newPath };
    } catch (error) {
      console.error('[Main] 重命名文件失败:', error);
      throw error;
    }
  });

  /**
   * 创建新文件
   */
  ipcMain.handle('file:createFile', async (_event, { projectId, filePath, content = '' }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 创建文件:', filePath);

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 确保目录存在
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

      // 创建文件
      await fs.writeFile(resolvedPath, content, 'utf-8');

      console.log('[Main] 文件创建成功');

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'created',
          filePath
        });
      }

      return { success: true, filePath };
    } catch (error) {
      console.error('[Main] 创建文件失败:', error);
      throw error;
    }
  });

  /**
   * 创建新文件夹
   */
  ipcMain.handle('file:createFolder', async (_event, { projectId, folderPath }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 创建文件夹:', folderPath);

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, folderPath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 创建文件夹
      await fs.mkdir(resolvedPath, { recursive: true });

      console.log('[Main] 文件夹创建成功');

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'created',
          filePath: folderPath
        });
      }

      return { success: true, folderPath };
    } catch (error) {
      console.error('[Main] 创建文件夹失败:', error);
      throw error;
    }
  });

  /**
   * 使用默认程序打开文件
   */
  ipcMain.handle('file:openWithDefault', async (_event, { projectId, filePath }) => {
    try {
      console.log('[Main] 使用默认程序打开文件:', filePath);

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 使用默认程序打开
      await shell.openPath(resolvedPath);

      return { success: true };
    } catch (error) {
      console.error('[Main] 打开文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 系统剪贴板操作 (4 handlers)
  // ============================================================

  /**
   * 复制文件到系统剪贴板
   */
  ipcMain.handle('file:copyToSystemClipboard', async (_event, { projectId, filePath, fullPath, isDirectory, fileName }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 复制文件到系统剪贴板:', { filePath, fullPath });

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 检查文件是否存在
      const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
      if (!exists) {
        throw new Error(`文件不存在: ${resolvedPath}`);
      }

      // 将文件路径写入系统剪贴板
      clipboard.writeBuffer('FileNameW', Buffer.from(resolvedPath + '\0', 'ucs2'));

      console.log('[Main] 文件路径已写入系统剪贴板');

      return { success: true, filePath: resolvedPath };
    } catch (error) {
      console.error('[Main] 复制到系统剪贴板失败:', error);
      throw error;
    }
  });

  /**
   * 剪切文件到系统剪贴板
   */
  ipcMain.handle('file:cutToSystemClipboard', async (_event, { projectId, filePath, fullPath, isDirectory, fileName }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 剪切文件到系统剪贴板:', { filePath, fullPath });

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 检查文件是否存在
      const exists = await fs.access(resolvedPath).then(() => true).catch(() => false);
      if (!exists) {
        throw new Error(`文件不存在: ${resolvedPath}`);
      }

      // 将文件路径写入系统剪贴板（标记为剪切）
      clipboard.writeBuffer('FileNameW', Buffer.from(resolvedPath + '\0', 'ucs2'));
      clipboard.writeText('cut:' + resolvedPath); // 使用文本标记为剪切操作

      console.log('[Main] 文件已标记为剪切到系统剪贴板');

      return { success: true, filePath: resolvedPath, operation: 'cut' };
    } catch (error) {
      console.error('[Main] 剪切到系统剪贴板失败:', error);
      throw error;
    }
  });

  /**
   * 从系统剪贴板粘贴
   */
  ipcMain.handle('file:pasteFromSystemClipboard', async () => {
    try {
      console.log('[Main] 从系统剪贴板读取');

      // 读取剪贴板内容
      const text = clipboard.readText();
      const buffer = clipboard.readBuffer('FileNameW');

      // 判断是复制还是剪切
      const isCut = text && text.startsWith('cut:');
      const operation = isCut ? 'cut' : 'copy';

      // 解析文件路径
      let filePath = null;
      if (buffer && buffer.length > 0) {
        filePath = buffer.toString('ucs2').replace(/\0/g, '');
      } else if (text && !isCut) {
        filePath = text;
      } else if (isCut) {
        filePath = text.substring(4);
      }

      console.log('[Main] 剪贴板内容:', { filePath, operation });

      return {
        success: true,
        filePath,
        operation,
        hasData: !!filePath
      };
    } catch (error) {
      console.error('[Main] 读取系统剪贴板失败:', error);
      throw error;
    }
  });

  /**
   * 从系统剪贴板导入文件到项目
   */
  ipcMain.handle('file:importFromSystemClipboard', async (_event, { projectId, targetPath, clipboardData }) => {
    try {
      const fs = require('fs').promises;

      console.log('[Main] 从系统剪贴板导入文件:', { targetPath, clipboardData });

      if (!clipboardData || !clipboardData.filePath) {
        throw new Error('剪贴板数据无效');
      }

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const sourcePath = clipboardData.filePath;
      const fileName = path.basename(sourcePath);
      const resolvedTargetPath = path.join(rootPath, targetPath, fileName);

      console.log('[Main] 源路径:', sourcePath);
      console.log('[Main] 目标路径:', resolvedTargetPath);

      // 确保目标目录存在
      await fs.mkdir(path.dirname(resolvedTargetPath), { recursive: true });

      if (clipboardData.operation === 'cut') {
        // 剪切：移动文件
        await fs.rename(sourcePath, resolvedTargetPath);
        clipboard.clear(); // 清空剪贴板
      } else {
        // 复制：复制文件
        await fs.copyFile(sourcePath, resolvedTargetPath);
      }

      console.log('[Main] 文件导入成功');

      const newPath = path.relative(rootPath, resolvedTargetPath);

      // 通知渲染进程刷新文件列表
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project:files-updated', {
          projectId,
          action: 'imported',
          filePath: newPath
        });
      }

      return { success: true, filePath: newPath };
    } catch (error) {
      console.error('[Main] 从剪贴板导入文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 扩展操作 (2 handlers)
  // ============================================================

  /**
   * 使用指定程序打开文件
   */
  ipcMain.handle('file:openWith', async (_event, { projectId, filePath }) => {
    try {
      console.log('[Main] 选择程序打开文件:', filePath);

      // 获取项目根路径
      const project = database.db.prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId);
      if (!project?.root_path) {
        throw new Error('项目没有根路径');
      }

      const rootPath = project.root_path;
      const resolvedPath = path.join(rootPath, filePath);

      console.log('[Main] 解析后的路径:', resolvedPath);

      // 显示打开方式对话框
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择打开方式',
        properties: ['openFile'],
        filters: [
          { name: '可执行文件', extensions: ['exe', 'app', 'sh'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const programPath = result.filePaths[0];
      console.log('[Main] 选择的程序:', programPath);

      // 使用指定程序打开文件
      const { spawn } = require('child_process');
      spawn(programPath, [resolvedPath], { detached: true, stdio: 'ignore' }).unref();

      return { success: true, programPath };
    } catch (error) {
      console.error('[Main] 选择程序打开文件失败:', error);
      throw error;
    }
  });

  /**
   * 使用指定程序路径打开文件
   */
  ipcMain.handle('file:openWithProgram', async (_event, { filePath, programPath }) => {
    try {
      console.log('[Main] 使用指定程序打开文件:', { filePath, programPath });

      const { spawn } = require('child_process');
      spawn(programPath, [filePath], { detached: true, stdio: 'ignore' }).unref();

      return { success: true };
    } catch (error) {
      console.error('[Main] 使用指定程序打开文件失败:', error);
      throw error;
    }
  });

  console.log('[File IPC] ✓ 17 handlers registered');
  console.log('[File IPC] - 3 file read/write handlers');
  console.log('[File IPC] - 8 file management handlers');
  console.log('[File IPC] - 4 system clipboard handlers');
  console.log('[File IPC] - 2 extended operation handlers');
}

module.exports = {
  registerFileIPC
};
