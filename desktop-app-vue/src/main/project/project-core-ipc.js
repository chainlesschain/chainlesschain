/**
 * Project Core IPC 处理器
 * 负责项目核心管理的前后端通信
 *
 * @module project-core-ipc
 * @description 提供项目的 CRUD、文件管理、同步恢复、监听器等核心 IPC 接口
 */

const { ipcMain } = require('electron');
const crypto = require('crypto');

/**
 * 注册所有 Project Core IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器
 * @param {Function} dependencies.removeUndefinedValues - 清理 undefined 值的函数
 * @param {Function} dependencies._replaceUndefinedWithNull - 替换 undefined 为 null 的函数
 */
function registerProjectCoreIPC({
  database,
  fileSyncManager,
  removeUndefinedValues,
  _replaceUndefinedWithNull
}) {
  console.log('[Project Core IPC] Registering Project Core IPC handlers...');

  // ============================================================
  // 项目 CRUD 操作 (Project CRUD Operations)
  // ============================================================

  /**
   * 获取所有项目（本地SQLite）
   * Channel: 'project:get-all'
   */
  ipcMain.handle('project:get-all', async (_event, userId) => {
    try {
      console.log('[Main] ===== 开始获取项目列表 =====');
      if (!database) {
        throw new Error('数据库未初始化');
      }

      console.log('[Main] 获取项目列表，userId:', userId);
      const projects = database.getProjects(userId);
      console.log('[Main] 原始项目数量:', projects ? projects.length : 0);

      if (!projects || projects.length === 0) {
        console.log('[Main] 没有项目，返回空数组');
        return [];
      }

      // 打印第一个项目的键，帮助调试
      if (projects[0]) {
        console.log('[Main] 第一个项目的键:', Object.keys(projects[0]));
        console.log('[Main] 第一个项目的部分数据:', {
          id: projects[0].id,
          name: projects[0].name,
          project_type: projects[0].project_type
        });
      }

      console.log('[Main] 开始清理数据...');
      const cleaned = removeUndefinedValues(projects);
      console.log('[Main] 清理完成，清理后的项目数量:', cleaned ? cleaned.length : 0);

      // 确保返回的是有效的数组
      if (!cleaned || !Array.isArray(cleaned)) {
        console.warn('[Main] 清理后的结果不是数组，返回空数组');
        return [];
      }

      console.log('[Main] 准备返回项目列表');
      return cleaned;
    } catch (error) {
      console.error('[Main] 获取项目列表失败:', error);
      console.error('[Main] 错误堆栈:', error.stack);
      // 出错时返回空数组而不是抛出异常，避免IPC序列化错误
      return [];
    }
  });

  /**
   * 获取单个项目
   * Channel: 'project:get'
   */
  ipcMain.handle('project:get', async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      const project = database.getProjectById(projectId);
      return removeUndefinedValues(project);
    } catch (error) {
      console.error('[Main] 获取项目失败:', error);
      throw error;
    }
  });

  /**
   * 创建项目（调用后端）
   * Channel: 'project:create'
   */
  ipcMain.handle('project:create', async (_event, createData) => {
    try {
      // 首先清理输入数据中的 undefined 值（IPC 已经不应该传递 undefined，但双重保险）
      const cleanedCreateData = _replaceUndefinedWithNull(createData);
      console.log('[Main] 开始创建项目，参数:', JSON.stringify(cleanedCreateData, null, 2));

      const { getProjectHTTPClient } = require('./http-client');
      const httpClient = getProjectHTTPClient();

      // 调用后端API
      const project = await httpClient.createProject(cleanedCreateData);
      console.log('[Main] 后端返回项目，键:', Object.keys(project || {}));

      // 保存到本地数据库
      if (database && project) {
        // 先清理 project 中的 undefined，再保存到数据库
        const cleanedProject = _replaceUndefinedWithNull(project);
        console.log('[Main] 清理后的项目:', JSON.stringify(cleanedProject, null, 2));

        const localProject = {
          ...cleanedProject,
          user_id: cleanedCreateData.userId || 'default-user',
          sync_status: 'synced',
          synced_at: Date.now(),
          file_count: cleanedProject.files ? cleanedProject.files.length : 0, // 设置文件数量
        };

        // 检查 localProject 中是否有 undefined
        console.log('[Main] localProject 准备保存到数据库');
        Object.keys(localProject).forEach(key => {
          const value = localProject[key];
          console.log(`[Main]   ${key}: ${typeof value === 'undefined' ? 'UNDEFINED!' : typeof value} = ${JSON.stringify(value).substring(0, 100)}`);
        });

        try {
          console.log('[Main] 调用 saveProject...');
          await database.saveProject(localProject);
          console.log('[Main] 项目已保存到本地数据库');
        } catch (saveError) {
          console.error('[Main] saveProject 失败:', saveError.message);
          console.error('[Main] saveProject 堆栈:', saveError.stack);
          throw saveError;
        }

        // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
        const projectType = cleanedProject.project_type || cleanedProject.projectType;
        try {
          const { getProjectConfig } = require('./project-config');
          const projectConfig = getProjectConfig();
          const projectRootPath = require('path').join(
            projectConfig.getProjectsRootPath(),
            cleanedProject.id
          );

          console.log('[Main] 创建项目目录:', projectRootPath, '项目类型:', projectType);
          await require('fs').promises.mkdir(projectRootPath, { recursive: true });

          // 立即更新项目的root_path（无论项目类型和是否有文件）
          // updateProject 是同步函数
          database.updateProject(cleanedProject.id, {
            root_path: projectRootPath,
          });
          console.log('[Main] 项目root_path已设置:', projectRootPath);
        } catch (dirError) {
          console.error('[Main] 创建项目目录失败:', dirError);
          // 继续执行，不影响项目创建
        }

        // 保存项目文件
        if (cleanedProject.files && cleanedProject.files.length > 0) {
          try {
            console.log('[Main] 开始保存文件，数量:', cleanedProject.files.length);
            // 清理文件数组中的 undefined
            const cleanedFiles = _replaceUndefinedWithNull(cleanedProject.files);
            await database.saveProjectFiles(cleanedProject.id, cleanedFiles);
            console.log('[Main] 项目文件已保存');
          } catch (fileError) {
            console.error('[Main] saveProjectFiles 失败:', fileError.message);
            console.error('[Main] saveProjectFiles 堆栈:', fileError.stack);
            throw fileError;
          }
        }
      }

      // 清理undefined值（IPC无法序列化undefined）
      console.log('[Main] 开始清理 undefined 值');
      console.log('[Main] 清理前的项目键值:', JSON.stringify(Object.keys(project)));

      // 检查每个键的值
      Object.keys(project).forEach(key => {
        if (project[key] === undefined) {
          console.warn(`[Main] 发现 undefined 值在键: ${key}`);
        }
      });

      const cleanProject = removeUndefinedValues(project);
      console.log('[Main] 清理完成，返回项目');
      console.log('[Main] 清理后的项目键:', Object.keys(cleanProject));

      // 再次检查清理后的值
      Object.keys(cleanProject).forEach(key => {
        if (cleanProject[key] === undefined) {
          console.error(`[Main] 清理后仍有 undefined 值在键: ${key}`);
        }
      });

      // 最终安全检查：递归替换所有undefined为null
      const safeProject = _replaceUndefinedWithNull(cleanProject);
      console.log('[Main] 最终安全检查完成');

      return safeProject;
    } catch (error) {
      console.error('[Main] 创建项目失败:', error);
      throw error;
    }
  });

  /**
   * 流式创建项目（SSE）
   * Channel: 'project:create-stream'
   */
  ipcMain.handle('project:create-stream', async (event, createData) => {
    const { getProjectHTTPClient } = require('./http-client');
    const httpClient = getProjectHTTPClient();
    const fs = require('fs').promises;
    const path = require('path');
    const { getProjectConfig } = require('./project-config');

    // 流式状态
    let streamControl = null;
    let accumulatedData = {
      stages: [],
      contentByStage: {},
      files: [],
      metadata: {},
    };

    try {
      // 清理输入数据中的 undefined 值
      const cleanedCreateData = _replaceUndefinedWithNull(createData);
      console.log('[Main] 开始流式创建项目，参数:', JSON.stringify(cleanedCreateData, null, 2));

      streamControl = await httpClient.createProjectStream(cleanedCreateData, {
        // 进度回调
        onProgress: (data) => {
          accumulatedData.stages.push({
            stage: data.stage,
            message: data.message,
            timestamp: Date.now(),
          });
          console.log(`[Main] 流式进度: ${data.stage} - ${data.message}`);

          // 发送流式进度事件
          event.sender.send('project:stream-chunk', {
            type: 'progress',
            data,
          });

          // 发送任务执行事件
          event.sender.send('project:task-execute', {
            stage: data.stage,
            name: data.stage,
            message: data.message,
            status: 'running',
            timestamp: Date.now(),
          });
        },

        // 内容回调
        onContent: (data) => {
          if (!accumulatedData.contentByStage[data.stage]) {
            accumulatedData.contentByStage[data.stage] = '';
          }
          accumulatedData.contentByStage[data.stage] += data.content;

          console.log(`[Main] 流式内容: ${data.stage}, 长度: ${data.content.length}`);
          event.sender.send('project:stream-chunk', {
            type: 'content',
            data,
          });
        },

        // 完成回调
        onComplete: async (data) => {
          // 兼容不同引擎的数据结构
          // Web引擎: { type: "complete", files: [...], metadata: {...} }
          // Document/Data引擎: { type: "complete", project_type: "document", result: { files: [...], metadata: {...} } }
          const result = data.result || data;
          accumulatedData.files = result.files || [];
          accumulatedData.metadata = result.metadata || {};

          console.log('[Main] 流式创建完成，文件数量:', accumulatedData.files.length);
          console.log('[Main] 项目类型:', data.project_type);

          // 统一数据结构：将result中的数据提升到顶层
          if (data.result) {
            data.files = result.files;
            data.metadata = result.metadata;
          }

          // 保存到SQLite数据库
          if (database && accumulatedData.files.length > 0) {
            try {
              // 确定项目类型：优先使用后端返回的类型，然后用户指定的类型，最后默认web
              const projectType = data.project_type || cleanedCreateData.projectType || 'web';

              // 构建项目对象
              const localProject = {
                id: crypto.randomUUID(),
                name: cleanedCreateData.name || '未命名项目',
                projectType: projectType,
                userId: cleanedCreateData.userId || 'default-user',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metadata: JSON.stringify(accumulatedData.metadata),
                user_id: cleanedCreateData.userId || 'default-user',
                sync_status: 'pending',
                file_count: accumulatedData.files.length, // 设置文件数量
              };

              console.log('[Main] 保存项目到数据库，ID:', localProject.id);
              await database.saveProject(localProject);

              // 为所有类型项目创建根目录并设置root_path（统一从系统配置读取）
              try {
                const projectConfig = getProjectConfig();
                const projectRootPath = path.join(
                  projectConfig.getProjectsRootPath(),
                  localProject.id
                );

                console.log('[Main] 创建项目目录:', projectRootPath, '项目类型:', projectType);
                await fs.mkdir(projectRootPath, { recursive: true });

                // 立即更新项目的root_path（无论项目类型和是否有文件）
                // updateProject 是同步函数
                database.updateProject(localProject.id, {
                  root_path: projectRootPath,
                });
                console.log('[Main] 项目root_path已设置:', projectRootPath);

                // 如果有文件，写入到文件系统
                if (accumulatedData.files.length > 0) {
                  for (const file of accumulatedData.files) {
                    const filePath = path.join(projectRootPath, file.path);
                    console.log('[Main] 写入文件:', filePath);

                    // 解码base64内容
                    let fileContent;
                    if (file.content_encoding === 'base64') {
                      fileContent = Buffer.from(file.content, 'base64');
                      console.log('[Main] 已解码base64内容，大小:', fileContent.length, 'bytes');
                    } else if (typeof file.content === 'string') {
                      fileContent = Buffer.from(file.content, 'utf-8');
                    } else {
                      fileContent = file.content;
                    }

                    await fs.writeFile(filePath, fileContent);
                    console.log('[Main] 文件写入成功:', file.path);
                  }
                }
              } catch (writeError) {
                console.error('[Main] 创建项目目录或写入文件失败:', writeError);
                console.error('[Main] 错误堆栈:', writeError.stack);
                // 不抛出错误，继续处理
              }

              // 保存项目文件到数据库
              const cleanedFiles = _replaceUndefinedWithNull(accumulatedData.files);
              console.log('[Main] 准备保存文件到数据库，文件数量:', cleanedFiles.length);
              if (cleanedFiles.length > 0) {
                console.log('[Main] 第一个文件:', {
                  path: cleanedFiles[0].path,
                  type: cleanedFiles[0].type,
                  hasContent: !!cleanedFiles[0].content,
                  contentLength: cleanedFiles[0].content ? cleanedFiles[0].content.length : 0
                });
              }
              await database.saveProjectFiles(localProject.id, cleanedFiles);
              console.log('[Main] 项目文件已保存到数据库');

              // 验证保存是否成功
              const savedFiles = database.getProjectFiles(localProject.id);
              console.log('[Main] 验证：数据库中的文件数量:', savedFiles?.length || 0);

              // 更新项目的file_count
              if (savedFiles && savedFiles.length > 0) {
                // updateProject 是同步函数
                database.updateProject(localProject.id, {
                  file_count: savedFiles.length,
                  updated_at: Date.now()
                });
                console.log('[Main] 已更新项目的file_count为:', savedFiles.length);
              }

              // 返回包含本地ID的完整数据
              data.projectId = localProject.id;
            } catch (saveError) {
              console.error('[Main] 保存项目失败:', saveError);
              event.sender.send('project:stream-chunk', {
                type: 'error',
                error: `保存失败: ${saveError.message}`,
              });
              return;
            }
          }

          // 发送完成事件
          console.log('[Main] ===== 发送complete事件到前端 =====');
          console.log('[Main] Complete data keys:', Object.keys(data));
          console.log('[Main] Complete data.projectId:', data.projectId);

          event.sender.send('project:stream-chunk', {
            type: 'complete',
            data: data,  // 直接发送，不使用_replaceUndefinedWithNull
          });

          console.log('[Main] ===== Complete事件已发送 =====');
        },

        // 错误回调
        onError: (error) => {
          console.error('[Main] 流式创建错误:', error);
          event.sender.send('project:stream-chunk', {
            type: 'error',
            error: error.message,
          });
        },
      });

      // 监听取消事件
      const handleCancel = () => {
        console.log('[Main] 收到取消请求');
        if (streamControl) {
          streamControl.cancel();
        }
      };
      ipcMain.once('project:stream-cancel-event', handleCancel);

      return { success: true };

    } catch (error) {
      console.error('[Main] Stream create failed:', error);
      event.sender.send('project:stream-chunk', {
        type: 'error',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  });

  /**
   * 取消流式创建
   * Channel: 'project:stream-cancel'
   */
  ipcMain.handle('project:stream-cancel', () => {
    console.log('[Main] 触发取消事件');
    // 触发取消事件
    ipcMain.emit('project:stream-cancel-event');
    return { success: true };
  });

  /**
   * 快速创建项目（不使用AI）
   * Channel: 'project:create-quick'
   */
  ipcMain.handle('project:create-quick', async (_event, createData) => {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const { getProjectConfig } = require('./project-config');

      console.log('[Main] 开始快速创建项目，参数:', createData);

      // 生成项目ID
      const projectId = crypto.randomUUID();
      const timestamp = Date.now();

      // 创建项目文件夹
      const projectConfig = getProjectConfig();
      const projectRootPath = path.join(
        projectConfig.getProjectsRootPath(),
        projectId
      );

      console.log('[Main] 创建项目目录:', projectRootPath);
      await fs.mkdir(projectRootPath, { recursive: true });

      // 创建一个默认的README.md文件
      const readmePath = path.join(projectRootPath, 'README.md');
      const readmeContent = `# ${createData.name}\n\n${createData.description || '这是一个新建的项目。'}\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n`;
      await fs.writeFile(readmePath, readmeContent, 'utf-8');

      // 构建项目对象
      const project = {
        id: projectId,
        name: createData.name,
        description: createData.description || '',
        project_type: createData.projectType || 'document', // 默认为document类型（允许的类型：web, document, data, app）
        user_id: createData.userId || 'default-user',
        root_path: projectRootPath,
        created_at: timestamp,
        updated_at: timestamp,
        sync_status: 'pending', // 使用pending状态（允许的类型：synced, pending, conflict, error）
        file_count: 1, // 包含README.md
        metadata: JSON.stringify({
          created_by: 'quick-create',
          created_at: new Date().toISOString(),
        }),
      };

      // 保存到本地数据库
      if (database) {
        await database.saveProject(project);
        console.log('[Main] 项目已保存到本地数据库');

        // 保存项目文件记录
        const file = {
          project_id: projectId,
          file_name: 'README.md',
          file_path: 'README.md',
          file_type: 'markdown',
          content: readmeContent,
          created_at: timestamp,
          updated_at: timestamp,
        };
        await database.saveProjectFiles(projectId, [file]);
        console.log('[Main] 项目文件已保存到数据库');
      }

      console.log('[Main] 快速创建项目成功，ID:', projectId);
      return _replaceUndefinedWithNull(project);
    } catch (error) {
      console.error('[Main] 快速创建项目失败:', error);
      throw error;
    }
  });

  /**
   * 保存项目到本地SQLite
   * Channel: 'project:save'
   */
  ipcMain.handle('project:save', async (_event, project) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      // 清理输入的 project 中的 undefined 值
      const cleanProject = _replaceUndefinedWithNull(project);
      const saved = database.saveProject(cleanProject);
      return removeUndefinedValues(saved);
    } catch (error) {
      console.error('[Main] 保存项目失败:', error);
      throw error;
    }
  });

  /**
   * 更新项目
   * Channel: 'project:update'
   */
  ipcMain.handle('project:update', async (_event, projectId, updates) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      // 清理输入的 updates 中的 undefined 值
      const cleanUpdates = _replaceUndefinedWithNull(updates);

      const updatedProject = {
        ...cleanUpdates,
        updated_at: Date.now(),
        sync_status: 'pending',
      };

      const result = database.updateProject(projectId, updatedProject);
      return removeUndefinedValues(result);
    } catch (error) {
      console.error('[Main] 更新项目失败:', error);
      throw error;
    }
  });

  /**
   * 删除项目（本地 + 后端）
   * Channel: 'project:delete'
   */
  ipcMain.handle('project:delete', async (_event, projectId) => {
    try {
      // 1. 先删除本地数据库（确保用户立即看不到）
      if (database) {
        try {
          await database.deleteProject(projectId);
          console.log('[Main] 本地项目已删除:', projectId);
        } catch (dbError) {
          console.warn('[Main] 删除本地项目失败（继续删除后端）:', dbError.message);
        }
      }

      // 2. 尝试删除后端（best effort，失败不影响结果）
      try {
        const { getProjectHTTPClient } = require('./http-client');
        const httpClient = getProjectHTTPClient();
        await httpClient.deleteProject(projectId);
        console.log('[Main] 后端项目已删除:', projectId);
      } catch (httpError) {
        // 如果是"项目不存在"，视为成功（幂等性）
        if (httpError.message && httpError.message.includes('项目不存在')) {
          console.log('[Main] 后端项目不存在，视为删除成功');
        } else {
          console.warn('[Main] 删除后端项目失败（已删除本地）:', httpError.message);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('[Main] 删除项目失败:', error);
      throw error;
    }
  });

  /**
   * 删除本地项目
   * Channel: 'project:delete-local'
   */
  ipcMain.handle('project:delete-local', async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      return database.deleteProject(projectId);
    } catch (error) {
      console.error('[Main] 删除本地项目失败:', error);
      throw error;
    }
  });

  /**
   * 从后端获取项目
   * Channel: 'project:fetch-from-backend'
   */
  ipcMain.handle('project:fetch-from-backend', async (_event, projectId) => {
    try {
      const { getProjectHTTPClient } = require('./http-client');
      const httpClient = getProjectHTTPClient();

      const project = await httpClient.getProject(projectId);

      // 保存到本地
      if (database && project) {
        await database.saveProject({
          ...project,
          sync_status: 'synced',
          synced_at: Date.now(),
        });
      }

      return removeUndefinedValues(project);
    } catch (error) {
      console.error('[Main] 从后端获取项目失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 路径修复操作 (Path Repair Operations)
  // ============================================================

  /**
   * 修复项目路径（为没有 root_path 的项目设置路径）
   * Channel: 'project:fix-path'
   */
  ipcMain.handle('project:fix-path', async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      const fs = require('fs').promises;
      const path = require('path');

      // 获取项目信息
      const project = database.getProjectById(projectId);
      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      // 如果已经有 root_path，不需要修复
      if (project.root_path) {
        console.log('[Main] 项目已有 root_path，无需修复:', project.root_path);
        return { success: true, message: '项目路径正常', path: project.root_path };
      }

      // 创建项目目录
      const { getProjectConfig } = require('./project-config');
      const projectConfig = getProjectConfig();
      const projectRootPath = path.join(
        projectConfig.getProjectsRootPath(),
        projectId
      );

      console.log('[Main] 为项目创建目录:', projectRootPath);
      await fs.mkdir(projectRootPath, { recursive: true });

      // 更新项目的 root_path
      database.updateProject(projectId, {
        root_path: projectRootPath,
      });

      // 获取项目文件并写入文件系统
      const projectFiles = database.db.prepare(
        'SELECT * FROM project_files WHERE project_id = ?'
      ).all(projectId);

      let fileCount = 0;
      if (projectFiles && projectFiles.length > 0) {
        console.log(`[Main] 写入 ${projectFiles.length} 个文件到文件系统`);

        for (const file of projectFiles) {
          try {
            const filePath = path.join(projectRootPath, file.file_path || file.file_name);

            // 确保文件目录存在
            await fs.mkdir(path.dirname(filePath), { recursive: true });

            // 写入文件内容
            await fs.writeFile(filePath, file.content || '', 'utf8');

            // 更新文件的 fs_path
            database.db.run(
              'UPDATE project_files SET fs_path = ? WHERE id = ?',
              [filePath, file.id]
            );

            fileCount++;
          } catch (fileError) {
            console.error(`[Main] 写入文件失败: ${file.file_name}`, fileError);
          }
        }
      }

      database.saveToFile();

      console.log('[Main] 项目路径修复完成:', projectRootPath);
      return {
        success: true,
        message: `路径已修复，写入 ${fileCount} 个文件`,
        path: projectRootPath,
        fileCount
      };

    } catch (error) {
      console.error('[Main] 修复项目路径失败:', error);
      throw error;
    }
  });

  /**
   * 修复项目的root_path（为document类型的项目创建目录并设置路径）
   * Channel: 'project:repair-root-path'
   */
  ipcMain.handle('project:repair-root-path', async (_event, projectId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      const project = database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const projectType = project.project_type || project.projectType;
      if (projectType !== 'document') {
        return { success: false, message: '只能修复document类型的项目' };
      }

      // 检查是否已有root_path
      if (project.root_path) {
        console.log('[Main] 项目已有root_path:', project.root_path);
        return { success: true, message: '项目已有root_path', rootPath: project.root_path };
      }

      // 创建项目目录
      const { getProjectConfig } = require('./project-config');
      const projectConfig = getProjectConfig();
      const projectRootPath = require('path').join(
        projectConfig.getProjectsRootPath(),
        projectId
      );

      console.log('[Main] 修复项目root_path，创建目录:', projectRootPath);
      await require('fs').promises.mkdir(projectRootPath, { recursive: true });

      // 更新数据库（updateProject 是同步函数）
      database.updateProject(projectId, {
        root_path: projectRootPath,
      });

      console.log('[Main] 项目root_path修复完成:', projectRootPath);
      return { success: true, message: '修复成功', rootPath: projectRootPath };
    } catch (error) {
      console.error('[Main] 修复项目root_path失败:', error);
      throw error;
    }
  });

  /**
   * 批量修复所有缺失root_path的document项目
   * Channel: 'project:repair-all-root-paths'
   */
  ipcMain.handle('project:repair-all-root-paths', async (_event) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      console.log('[Main] ========== 开始批量修复项目root_path ==========');

      // 查找所有缺失root_path的document项目
      const brokenProjects = database.db.prepare(`
        SELECT id, name, project_type, root_path
        FROM projects
        WHERE project_type = 'document'
          AND (root_path IS NULL OR root_path = '')
        ORDER BY created_at DESC
      `).all();

      console.log(`[Main] 发现 ${brokenProjects.length} 个缺失root_path的项目`);

      if (brokenProjects.length === 0) {
        return {
          success: true,
          message: '所有项目都有正确的root_path',
          fixed: 0,
          failed: 0,
          details: []
        };
      }

      const { getProjectConfig } = require('./project-config');
      const projectConfig = getProjectConfig();
      const results = {
        success: true,
        fixed: 0,
        failed: 0,
        details: []
      };

      // 逐个修复
      for (const project of brokenProjects) {
        try {
          const projectRootPath = require('path').join(
            projectConfig.getProjectsRootPath(),
            project.id
          );

          console.log(`[Main] 修复项目: ${project.name} (${project.id})`);
          console.log(`[Main]   创建目录: ${projectRootPath}`);

          // 创建目录
          await require('fs').promises.mkdir(projectRootPath, { recursive: true });

          // 更新数据库（updateProject 是同步函数）
          database.updateProject(project.id, {
            root_path: projectRootPath,
          });

          results.fixed++;
          results.details.push({
            id: project.id,
            name: project.name,
            status: 'fixed',
            rootPath: projectRootPath
          });

          console.log(`[Main]   ✅ 修复成功`);
        } catch (error) {
          console.error(`[Main]   ❌ 修复失败:`, error.message);
          results.failed++;
          results.details.push({
            id: project.id,
            name: project.name,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`[Main] ========== 批量修复完成 ==========`);
      console.log(`[Main] 修复成功: ${results.fixed} 个`);
      console.log(`[Main] 修复失败: ${results.failed} 个`);

      results.message = `修复完成：成功 ${results.fixed} 个，失败 ${results.failed} 个`;
      return results;
    } catch (error) {
      console.error('[Main] 批量修复失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 文件管理操作 (File Management Operations)
  // ============================================================

  /**
   * 获取项目文件列表（直接从文件系统读取）
   * Channel: 'project:get-files'
   */
  ipcMain.handle('project:get-files', async (_event, projectId, fileType = null, pageNum = 1, pageSize = 50) => {
    try {
      console.log('[Main] 获取项目文件, ProjectId:', projectId, ', FileType:', fileType);

      if (!database) {
        throw new Error('数据库未初始化');
      }

      const project = database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const rootPath = project.root_path || project.folder_path;
      console.log('[Main] 项目根路径:', rootPath);

      if (!rootPath) {
        // 尝试自动修复
        try {
          const { getProjectConfig } = require('./project-config');
          const projectConfig = getProjectConfig();
          const projectRootPath = require('path').join(
            projectConfig.getProjectsRootPath(),
            projectId
          );

          console.log('[Main] 自动修复：创建项目目录:', projectRootPath);
          await require('fs').promises.mkdir(projectRootPath, { recursive: true });

          await database.updateProject(projectId, {
            root_path: projectRootPath,
          });

          project.root_path = projectRootPath;
        } catch (repairError) {
          console.error('[Main] 自动修复失败:', repairError.message);
          return [];
        }
      }

      const finalRootPath = project.root_path || project.folder_path;
      if (!finalRootPath) {
        return [];
      }

      const fs = require('fs').promises;
      const path = require('path');

      // 检查项目目录是否存在
      try {
        await fs.access(finalRootPath);
      } catch (error) {
        console.error('[Main] 项目目录不存在:', finalRootPath);
        return [];
      }

      // 递归读取文件系统
      const files = [];

      async function scanDirectory(dirPath, relativePath = '') {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            // 跳过隐藏文件和特定目录
            if (/(^|[\/\\])\.|node_modules|\.git|dist|build|out/.test(entry.name)) {
              continue;
            }

            const fullPath = path.join(dirPath, entry.name);
            const fileRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
            const isFolder = entry.isDirectory();

            try {
              const stats = await fs.stat(fullPath);

              const fileInfo = {
                id: 'fs_' + crypto.createHash('sha256').update(fileRelativePath).digest('hex').substring(0, 16),
                project_id: projectId,
                file_name: entry.name,
                file_path: fileRelativePath.replace(/\\/g, '/'),
                file_type: isFolder ? 'folder' : (path.extname(entry.name).substring(1) || 'file'),
                is_folder: isFolder,
                file_size: stats.size || 0,
                created_at: stats.birthtimeMs || Date.now(),
                updated_at: stats.mtimeMs || Date.now(),
                sync_status: 'synced',
                deleted: 0,
                version: 1,
              };

              files.push(fileInfo);

              if (isFolder) {
                await scanDirectory(fullPath, fileRelativePath);
              }
            } catch (statError) {
              console.error(`[Main] 无法读取文件状态 ${fileRelativePath}:`, statError.message);
            }
          }
        } catch (readError) {
          console.error(`[Main] 无法读取目录 ${dirPath}:`, readError.message);
        }
      }

      await scanDirectory(finalRootPath);

      // 从数据库读取文件记录
      const dbFiles = database.getProjectFiles(projectId);
      const dbFileMap = {};
      dbFiles.forEach(f => {
        if (f.file_path) {
          dbFileMap[f.file_path] = f;
        }
      });

      // 合并文件系统和数据库数据
      const mergedFiles = files.map(fsFile => {
        const dbFile = dbFileMap[fsFile.file_path];
        if (dbFile) {
          return {
            ...dbFile,
            ...fsFile,
            id: dbFile.id,
          };
        } else {
          return fsFile;
        }
      });

      // 如果指定了文件类型，进行过滤
      let filteredFiles = mergedFiles;
      if (fileType) {
        filteredFiles = mergedFiles.filter(f => f.file_type === fileType);
      }

      const result = removeUndefinedValues(filteredFiles);
      console.log(`[Main] 返回 ${result.length} 个文件`);

      return result;
    } catch (error) {
      console.error('[Main] 获取项目文件失败:', error);
      throw error;
    }
  });

  /**
   * 获取单个文件
   * Channel: 'project:get-file'
   */
  ipcMain.handle('project:get-file', async (_event, fileId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      const stmt = database.db.prepare('SELECT * FROM project_files WHERE id = ?');
      const file = stmt.get(fileId);
      return removeUndefinedValues(file);
    } catch (error) {
      console.error('[Main] 获取文件失败:', error);
      throw error;
    }
  });

  /**
   * 保存项目文件
   * Channel: 'project:save-files'
   */
  ipcMain.handle('project:save-files', async (_event, projectId, files) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }
      database.saveProjectFiles(projectId, files);
      return { success: true };
    } catch (error) {
      console.error('[Main] 保存项目文件失败:', error);
      throw error;
    }
  });

  /**
   * 更新文件
   * Channel: 'project:update-file'
   */
  ipcMain.handle('project:update-file', async (_event, fileUpdate) => {
    try {
      const { projectId, fileId, content, is_base64 } = fileUpdate;

      // 调用后端API
      const ProjectFileAPI = require('./project-file-api');
      const result = await ProjectFileAPI.updateFile(projectId, fileId, {
        content,
        is_base64
      });

      // 如果后端不可用，降级到本地数据库
      if (!result.success || result.status === 0) {
        console.warn('[Main] 后端服务不可用，使用本地数据库');
        if (!database) {
          throw new Error('数据库未初始化');
        }
        database.updateProjectFile(fileUpdate);
        return { success: true };
      }

      return result;
    } catch (error) {
      console.error('[Main] 更新文件失败:', error);
      // 降级到本地数据库
      if (database) {
        database.updateProjectFile(fileUpdate);
        return { success: true };
      }
      throw error;
    }
  });

  /**
   * 删除文件
   * Channel: 'project:delete-file'
   */
  ipcMain.handle('project:delete-file', async (_event, projectId, fileId) => {
    try {
      if (!database) {
        throw new Error('数据库未初始化');
      }

      const fs = require('fs').promises;
      const { getProjectConfig } = require('./project-config');
      const projectConfig = getProjectConfig();

      // 获取文件信息
      const file = database.db.get('SELECT * FROM project_files WHERE id = ?', [fileId]);

      if (file) {
        try {
          // 解析文件路径并删除物理文件
          const resolvedPath = projectConfig.resolveProjectPath(file.file_path);
          console.log('[Main] 删除物理文件:', resolvedPath);
          await fs.unlink(resolvedPath);
        } catch (error) {
          console.warn('[Main] 删除物理文件失败 (可能已不存在):', error.message);
        }
      }

      // 从数据库删除记录
      database.db.run('DELETE FROM project_files WHERE id = ?', [fileId]);

      // 更新项目的文件统计
      try {
        const totalFiles = database.db.prepare(
          `SELECT COUNT(*) as count FROM project_files WHERE project_id = ?`
        ).get(projectId);

        const fileCount = totalFiles ? totalFiles.count : 0;
        database.db.run(
          `UPDATE projects SET file_count = ?, updated_at = ? WHERE id = ?`,
          [fileCount, Date.now(), projectId]
        );
      } catch (updateError) {
        console.error('[Main] 更新项目file_count失败:', updateError);
      }

      database.saveToFile();

      console.log('[Main] 文件删除成功:', fileId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 删除文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 监听器操作 (Watcher Operations)
  // ============================================================

  /**
   * 索引项目对话历史
   * Channel: 'project:indexConversations'
   */
  ipcMain.handle('project:indexConversations', async (_event, projectId, options = {}) => {
    try {
      const { getProjectRAGManager } = require('./project-rag');
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      const result = await projectRAG.indexConversationHistory(projectId, options);

      console.log('[Main] 对话历史索引完成:', result);
      return result;
    } catch (error) {
      console.error('[Main] 索引对话历史失败:', error);
      throw error;
    }
  });

  /**
   * 启动文件监听
   * Channel: 'project:startWatcher'
   */
  ipcMain.handle('project:startWatcher', async (_event, projectId, projectPath) => {
    try {
      const { getProjectRAGManager } = require('./project-rag');
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      await projectRAG.startFileWatcher(projectId, projectPath);

      console.log('[Main] 文件监听已启动:', projectPath);
      return { success: true };
    } catch (error) {
      console.error('[Main] 启动文件监听失败:', error);
      throw error;
    }
  });

  /**
   * 停止文件监听
   * Channel: 'project:stopWatcher'
   */
  ipcMain.handle('project:stopWatcher', async (_event, projectId) => {
    try {
      const { getProjectRAGManager } = require('./project-rag');
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      projectRAG.stopFileWatcher(projectId);

      console.log('[Main] 文件监听已停止:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 停止文件监听失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 路径解析操作 (Path Resolution)
  // ============================================================

  /**
   * 解析项目路径
   * Channel: 'project:resolve-path'
   */
  ipcMain.handle('project:resolve-path', async (_event, relativePath) => {
    try {
      const { getProjectConfig } = require('./project-config');
      const projectConfig = getProjectConfig();
      const resolvedPath = projectConfig.resolveProjectPath(relativePath);
      return { success: true, path: resolvedPath };
    } catch (error) {
      console.error('[Main] 解析路径失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 同步操作 (Sync Operations)
  // ============================================================

  /**
   * 同步项目
   * Channel: 'project:sync'
   */
  ipcMain.handle('project:sync', async (_event, userId) => {
    try {
      console.log('[Main] project:sync 开始同步，userId:', userId);

      const { getProjectHTTPClient } = require('./http-client');
      const httpClient = getProjectHTTPClient();

      // 1. 获取后端项目列表
      const response = await httpClient.listProjects(userId, 1, 1000);
      const backendProjects = (response && response.records) ? response.records : [];
      console.log('[Main] 从后端获取到项目数量:', backendProjects.length);

      // 2. 获取本地项目
      const localProjects = database ? database.getProjects(userId) : [];

      // 3. 合并数据并同步文件
      if (database) {
        for (const project of backendProjects) {
          try {
            // 获取项目详情（包含文件列表）
            let projectDetail = project;
            if (!project.files || project.files.length === 0) {
              try {
                projectDetail = await httpClient.getProject(project.id);
              } catch (detailError) {
                console.warn(`[Main] 获取项目 ${project.id} 详情失败:`, detailError.message);
                projectDetail = project;
              }
            }

            const createdAt = projectDetail.createdAt ? new Date(projectDetail.createdAt).getTime() : Date.now();
            const updatedAt = projectDetail.updatedAt ? new Date(projectDetail.updatedAt).getTime() : Date.now();

            // 构建项目对象，避免 undefined 值
            const projectData = {
              id: projectDetail.id,
              user_id: projectDetail.userId,
              name: projectDetail.name,
              project_type: projectDetail.projectType,
              status: projectDetail.status || 'active',
              file_count: projectDetail.fileCount || 0,
              total_size: projectDetail.totalSize || 0,
              tags: JSON.stringify(projectDetail.tags || []),
              metadata: JSON.stringify(projectDetail.metadata || {}),
              created_at: createdAt,
              updated_at: updatedAt,
              synced_at: Date.now(),
              sync_status: 'synced',
            };

            // 只有当字段存在时才添加
            if (projectDetail.description) projectData.description = projectDetail.description;
            if (projectDetail.rootPath) projectData.root_path = projectDetail.rootPath;
            if (projectDetail.coverImageUrl) projectData.cover_image_url = projectDetail.coverImageUrl;

            database.saveProject(projectData);

            // 同步项目文件
            if (projectDetail.files && Array.isArray(projectDetail.files) && projectDetail.files.length > 0) {
              try {
                database.saveProjectFiles(projectDetail.id, projectDetail.files);
              } catch (fileError) {
                console.error(`[Main] 同步项目 ${projectDetail.id} 文件失败:`, fileError);
              }
            }
          } catch (projectError) {
            console.error(`[Main] 同步项目 ${project.id} 失败:`, projectError);
          }
        }
      }

      // 4. 推送本地pending的项目到后端
      const pendingProjects = localProjects.filter(p => p.sync_status === 'pending');
      for (const project of pendingProjects) {
        try {
          const cleanProject = _replaceUndefinedWithNull(project);
          await httpClient.syncProject(cleanProject);

          if (database) {
            database.updateProject(project.id, {
              sync_status: 'synced',
              synced_at: Date.now(),
            });
          }
        } catch (syncError) {
          console.error(`[Main] 同步项目 ${project.id} 失败:`, syncError);
        }
      }

      return { success: true };
    } catch (error) {
      console.error('[Main] 同步项目失败:', error);
      throw error;
    }
  });

  /**
   * 同步单个项目
   * Channel: 'project:sync-one'
   */
  ipcMain.handle('project:sync-one', async (_event, projectId) => {
    try {
      const { getProjectHTTPClient } = require('./http-client');
      const httpClient = getProjectHTTPClient();

      if (!database) {
        throw new Error('数据库未初始化');
      }

      const project = database.getProjectById(projectId);
      if (!project) {
        throw new Error('项目不存在');
      }

      const cleanProject = _replaceUndefinedWithNull(project);
      await httpClient.syncProject(cleanProject);

      database.updateProject(projectId, {
        sync_status: 'synced',
        synced_at: Date.now(),
      });

      return { success: true };
    } catch (error) {
      console.error('[Main] 同步单个项目失败:', error);
      throw error;
    }
  });

  // ============================================================
  // 项目恢复操作 (Project Recovery Operations)
  // ============================================================

  /**
   * 扫描可恢复的项目
   * Channel: 'project:scan-recoverable'
   */
  ipcMain.handle('project:scan-recoverable', async () => {
    try {
      const ProjectRecovery = require('../sync/project-recovery');
      const recovery = new ProjectRecovery(database);
      const recoverableProjects = recovery.scanRecoverableProjects();

      console.log(`[Main] 扫描到 ${recoverableProjects.length} 个可恢复的项目`);
      return {
        success: true,
        projects: recoverableProjects,
      };
    } catch (error) {
      console.error('[Main] 扫描可恢复项目失败:', error);
      return {
        success: false,
        error: error.message,
        projects: [],
      };
    }
  });

  /**
   * 恢复单个项目
   * Channel: 'project:recover'
   */
  ipcMain.handle('project:recover', async (_event, projectId) => {
    try {
      const ProjectRecovery = require('../sync/project-recovery');
      const recovery = new ProjectRecovery(database);
      const success = recovery.recoverProject(projectId);

      if (success) {
        console.log(`[Main] 成功恢复项目: ${projectId}`);
        return { success: true };
      } else {
        throw new Error('恢复失败');
      }
    } catch (error) {
      console.error(`[Main] 恢复项目失败: ${projectId}`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 批量恢复项目
   * Channel: 'project:recover-batch'
   */
  ipcMain.handle('project:recover-batch', async (_event, projectIds) => {
    try {
      const ProjectRecovery = require('../sync/project-recovery');
      const recovery = new ProjectRecovery(database);
      const results = recovery.recoverProjects(projectIds);

      console.log(`[Main] 批量恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`);
      return {
        success: true,
        results,
      };
    } catch (error) {
      console.error('[Main] 批量恢复项目失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 自动恢复所有可恢复的项目
   * Channel: 'project:auto-recover'
   */
  ipcMain.handle('project:auto-recover', async () => {
    try {
      const ProjectRecovery = require('../sync/project-recovery');
      const recovery = new ProjectRecovery(database);
      const results = recovery.autoRecoverAll();

      console.log(`[Main] 自动恢复完成: 成功 ${results.success.length}, 失败 ${results.failed.length}`);
      return {
        success: true,
        results,
      };
    } catch (error) {
      console.error('[Main] 自动恢复失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  /**
   * 获取恢复统计信息
   * Channel: 'project:recovery-stats'
   */
  ipcMain.handle('project:recovery-stats', async () => {
    try {
      const ProjectRecovery = require('../sync/project-recovery');
      const recovery = new ProjectRecovery(database);
      const stats = recovery.getRecoveryStats();

      return {
        success: true,
        stats,
      };
    } catch (error) {
      console.error('[Main] 获取恢复统计失败:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // ============================================================
  // 统计操作 (Statistics Operations)
  // ============================================================

  /**
   * 启动项目统计
   * Channel: 'project:stats:start'
   */
  ipcMain.handle('project:stats:start', async (_event, projectId, projectPath) => {
    try {
      const { getStatsCollector } = require('./stats-collector');
      const statsCollector = getStatsCollector();

      await statsCollector.initialize();
      await statsCollector.startProjectStats(projectId, projectPath);

      console.log('[Main] 项目统计已启动:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 启动项目统计失败:', error);
      throw error;
    }
  });

  /**
   * 停止项目统计
   * Channel: 'project:stats:stop'
   */
  ipcMain.handle('project:stats:stop', async (_event, projectId) => {
    try {
      const { getStatsCollector } = require('./stats-collector');
      const statsCollector = getStatsCollector();

      await statsCollector.initialize();
      statsCollector.stopProjectStats(projectId);

      console.log('[Main] 项目统计已停止:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 停止项目统计失败:', error);
      throw error;
    }
  });

  /**
   * 获取项目统计
   * Channel: 'project:stats:get'
   */
  ipcMain.handle('project:stats:get', async (_event, projectId) => {
    try {
      const { getStatsCollector } = require('./stats-collector');
      const statsCollector = getStatsCollector();

      await statsCollector.initialize();
      const stats = await statsCollector.getProjectStats(projectId);

      return { success: true, stats };
    } catch (error) {
      console.error('[Main] 获取项目统计失败:', error);
      throw error;
    }
  });

  /**
   * 更新项目统计
   * Channel: 'project:stats:update'
   */
  ipcMain.handle('project:stats:update', async (_event, projectId) => {
    try {
      const { getStatsCollector } = require('./stats-collector');
      const statsCollector = getStatsCollector();

      await statsCollector.initialize();
      await statsCollector.updateProjectStats(projectId);

      console.log('[Main] 项目统计已更新:', projectId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 更新项目统计失败:', error);
      throw error;
    }
  });

  console.log('[Project Core IPC] ✓ All Project Core IPC handlers registered successfully (34 handlers)');
}

module.exports = {
  registerProjectCoreIPC
};
