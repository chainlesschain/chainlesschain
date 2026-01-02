/**
 * Project AI IPC 处理器
 * 负责项目 AI 功能的前后端通信
 *
 * @module project-ai-ipc
 * @description 提供 AI 对话、任务规划、代码助手、内容处理等 IPC 接口
 */

const { ipcMain } = require('electron');
const axios = require('axios');
const crypto = require('crypto');

/**
 * 注册所有 Project AI IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.aiEngineManager - AI 引擎管理器
 * @param {Object} dependencies.chatSkillBridge - 聊天技能桥接器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.scanAndRegisterProjectFiles - 扫描注册文件函数
 */
function registerProjectAIIPC({
  database,
  llmManager,
  aiEngineManager,
  chatSkillBridge,
  mainWindow,
  scanAndRegisterProjectFiles
}) {
  console.log('[Project AI IPC] Registering Project AI IPC handlers...');

  // ============================================================
  // AI 对话功能 (AI Chat)
  // ============================================================

  /**
   * 项目AI对话 - 支持文件操作
   * Channel: 'project:aiChat'
   */
  ipcMain.handle('project:aiChat', async (_event, chatData) => {
    try {
      const { parseAIResponse } = require('../ai-engine/response-parser');
      const { executeOperations, ensureLogTable } = require('../ai-engine/conversation-executor');
      const path = require('path');

      console.log('[Main] 项目AI对话:', chatData);

      const {
        projectId,
        userMessage,
        conversationHistory,
        contextMode,
        currentFile,
        projectInfo,
        fileList
      } = chatData;

      // 1. 检查数据库
      if (!database) {
        throw new Error('数据库未初始化');
      }

      // 2. 获取项目信息
      const project = database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      const projectPath = project.root_path;

      // 验证项目路径
      if (!projectPath) {
        throw new Error(`项目路径未设置: ${projectId}，请在项目设置中指定项目根目录`);
      }

      console.log('[Main] 项目路径:', projectPath);

      // 3. 确保日志表存在
      await ensureLogTable(database);

      // 4. 准备后端API请求数据
      const currentFilePath = currentFile && typeof currentFile === 'object'
        ? currentFile.file_path
        : currentFile;

      // 5. 调用后端AI服务
      const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';

      const requestData = {
        project_id: projectId,
        user_message: userMessage,
        conversation_history: conversationHistory || [],
        context_mode: contextMode || 'project',
        current_file: currentFilePath || null,
        project_info: projectInfo || {
          name: project.name,
          description: project.description || '',
          type: project.project_type || 'general'
        },
        file_list: fileList || []
      };

      console.log('[Main] 发送到AI服务的数据:', JSON.stringify({
        ...requestData,
        file_list: `[${fileList?.length || 0} files]`
      }, null, 2));

      const response = await axios.post(
        `${AI_SERVICE_URL}/api/projects/${projectId}/chat`,
        requestData,
        {
          timeout: 60000  // 60秒超时
        }
      );

      const { response: aiResponse, operations, rag_sources } = response.data;

      console.log('[Main] AI响应:', aiResponse);
      console.log('[Main] 文件操作数量:', operations ? operations.length : 0);

      // 5. 使用ChatSkillBridge拦截并处理
      let bridgeResult = null;
      if (chatSkillBridge) {
        try {
          console.log('[Main] 使用ChatSkillBridge处理响应...');
          bridgeResult = await chatSkillBridge.interceptAndProcess(
            userMessage,
            aiResponse,
            {
              projectId,
              projectPath,
              currentFile: currentFilePath,
              conversationHistory
            }
          );

          console.log('[Main] 桥接器处理结果:', {
            shouldIntercept: bridgeResult.shouldIntercept,
            toolCallsCount: bridgeResult.toolCalls?.length || 0
          });
        } catch (error) {
          console.error('[Main] ChatSkillBridge处理失败:', error);
        }
      }

      // 6. 如果桥接器成功处理，返回增强响应
      if (bridgeResult && bridgeResult.shouldIntercept) {
        console.log('[Main] 使用桥接器处理结果');
        return {
          success: true,
          conversationResponse: bridgeResult.enhancedResponse,
          fileOperations: bridgeResult.executionResults || [],
          ragSources: rag_sources || [],
          hasFileOperations: bridgeResult.toolCalls.length > 0,
          usedBridge: true,
          toolCalls: bridgeResult.toolCalls,
          bridgeSummary: bridgeResult.summary
        };
      }

      // 7. 否则使用原有的解析逻辑
      console.log('[Main] 使用原有解析逻辑');
      const parsed = parseAIResponse(aiResponse, operations);

      // 8. 执行文件操作
      let operationResults = [];
      if (parsed.hasFileOperations) {
        console.log(`[Main] 执行 ${parsed.operations.length} 个文件操作`);

        try {
          operationResults = await executeOperations(
            parsed.operations,
            projectPath,
            database
          );

          console.log('[Main] 文件操作完成:', operationResults.length);
        } catch (error) {
          console.error('[Main] 文件操作执行失败:', error);
          operationResults = [{
            status: 'error',
            error: error.message
          }];
        }
      }

      // 9. 返回结果
      return {
        success: true,
        conversationResponse: aiResponse,
        fileOperations: operationResults,
        ragSources: rag_sources || [],
        hasFileOperations: parsed.hasFileOperations,
        usedBridge: false
      };

    } catch (error) {
      console.error('[Main] 项目AI对话失败:', error);

      if (error.code === 'ECONNREFUSED') {
        throw new Error('AI服务连接失败，请确保后端服务已启动');
      }

      throw error;
    }
  });

  /**
   * 扫描项目文件夹并添加到数据库
   * Channel: 'project:scan-files'
   */
  ipcMain.handle('project:scan-files', async (_event, projectId) => {
    try {
      console.log(`[Main] 扫描项目文件: ${projectId}`);
      const project = database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new Error('项目不存在');
      const rootPath = project.root_path || project.folder_path;
      if (!rootPath) throw new Error('项目没有根路径');

      const fs = require('fs').promises;
      const path = require('path');
      const addedFiles = [];

      async function scanDir(dir, base) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(base, fullPath);
          if (/(^|[\/\\])\.|node_modules|\.git|dist|build/.test(relativePath)) continue;
          if (entry.isDirectory()) {
            await scanDir(fullPath, base);
          } else if (entry.isFile()) {
            addedFiles.push({ fullPath, relativePath });
          }
        }
      }

      await scanDir(rootPath, rootPath);
      console.log(`[Main] 找到 ${addedFiles.length} 个文件`);

      let added = 0, skipped = 0;
      for (const { fullPath, relativePath } of addedFiles) {
        try {
          const exists = database.db.prepare('SELECT id FROM project_files WHERE project_id = ? AND file_path = ?').get(projectId, relativePath);
          if (exists) { skipped++; continue; }

          const content = await fs.readFile(fullPath, 'utf8');
          const stats = await fs.stat(fullPath);
          const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
          const ext = path.extname(relativePath).substring(1);
          const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(7);
          const now = Date.now();

          database.db.prepare(`INSERT INTO project_files (
            id, project_id, file_name, file_path, file_type, content, content_hash,
            file_size, created_at, updated_at, sync_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            fileId, projectId, path.basename(relativePath), relativePath, ext || 'file',
            content, hash, stats.size, now, now, 'synced'
          );

          added++;
        } catch (fileError) {
          console.error(`[Main] 添加文件失败 ${relativePath}:`, fileError.message);
        }
      }

      database.saveToFile();
      console.log(`[Main] 扫描完成: 添加 ${added} 个，跳过 ${skipped} 个`);

      return {
        success: true,
        added,
        skipped,
        total: addedFiles.length
      };
    } catch (error) {
      console.error('[Main] 扫描文件失败:', error);
      throw error;
    }
  });

  // ============================================================
  // AI 任务规划 (Task Planning)
  // ============================================================

  /**
   * AI智能拆解任务
   * Channel: 'project:decompose-task'
   */
  ipcMain.handle('project:decompose-task', async (_event, userRequest, projectContext) => {
    try {
      console.log('[Main] AI任务拆解:', userRequest);

      if (!aiEngineManager) {
        const { getAIEngineManager } = require('../ai-engine/ai-engine-manager');
        const manager = getAIEngineManager();
        await manager.initialize();
        const taskPlanner = manager.getTaskPlanner();
        return await taskPlanner.decomposeTask(userRequest, projectContext);
      }

      await aiEngineManager.initialize();
      const taskPlanner = aiEngineManager.getTaskPlanner();
      return await taskPlanner.decomposeTask(userRequest, projectContext);
    } catch (error) {
      console.error('[Main] AI任务拆解失败:', error);
      throw error;
    }
  });

  /**
   * 执行任务计划
   * Channel: 'project:execute-task-plan'
   */
  ipcMain.handle('project:execute-task-plan', async (_event, taskPlanId, projectContext) => {
    try {
      console.log('[Main] 执行任务计划:', taskPlanId);
      const { getProjectConfig } = require('./project-config');

      if (!aiEngineManager) {
        const { getAIEngineManager } = require('../ai-engine/ai-engine-manager');
        const manager = getAIEngineManager();
        await manager.initialize();
      } else {
        await aiEngineManager.initialize();
      }

      const taskPlanner = aiEngineManager.getTaskPlanner();
      const taskPlan = await taskPlanner.getTaskPlan(taskPlanId);
      if (!taskPlan) {
        throw new Error(`任务计划不存在: ${taskPlanId}`);
      }

      const projectId = projectContext.projectId || projectContext.id;
      console.log('[Main] 检查项目路径 - projectId:', projectId, 'root_path:', projectContext.root_path);

      if (!projectContext.root_path) {
        const fs = require('fs').promises;
        const path = require('path');
        const projectConfig = getProjectConfig();
        const dirName = projectId || `task_${taskPlanId}`;
        const projectRootPath = path.join(projectConfig.getProjectsRootPath(), dirName);

        await fs.mkdir(projectRootPath, { recursive: true });
        console.log('[Main] 项目目录已创建:', projectRootPath);

        if (projectId) {
          database.updateProject(projectId, {
            root_path: projectRootPath,
            updated_at: Date.now()
          });
        }

        projectContext.root_path = projectRootPath;
      }

      const result = await taskPlanner.executeTaskPlan(taskPlan, projectContext, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('task:progress-update', progress);
        }
      });

      if (result.success && scanAndRegisterProjectFiles) {
        try {
          let scanPath = projectContext.root_path;

          if (result.results && Array.isArray(result.results)) {
            for (const taskResult of result.results) {
              if (taskResult && taskResult.projectPath) {
                scanPath = taskResult.projectPath;
                break;
              }
            }
          }

          if (scanPath) {
            const filesRegistered = await scanAndRegisterProjectFiles(projectId, scanPath);

            if (filesRegistered > 0 && mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('project:files-updated', {
                projectId: projectId,
                filesCount: filesRegistered
              });
            }
          }
        } catch (scanError) {
          console.error('[Main] 扫描并注册文件失败:', scanError);
        }
      }

      return result;
    } catch (error) {
      console.error('[Main] 执行任务计划失败:', error);
      throw error;
    }
  });

  /**
   * 获取任务计划
   * Channel: 'project:get-task-plan'
   */
  ipcMain.handle('project:get-task-plan', async (_event, taskPlanId) => {
    try {
      if (!aiEngineManager) {
        const { getAIEngineManager } = require('../ai-engine/ai-engine-manager');
        const manager = getAIEngineManager();
        await manager.initialize();
        return await manager.getTaskPlanner().getTaskPlan(taskPlanId);
      }

      await aiEngineManager.initialize();
      return await aiEngineManager.getTaskPlanner().getTaskPlan(taskPlanId);
    } catch (error) {
      console.error('[Main] 获取任务计划失败:', error);
      throw error;
    }
  });

  /**
   * 获取项目的任务计划历史
   * Channel: 'project:get-task-plan-history'
   */
  ipcMain.handle('project:get-task-plan-history', async (_event, projectId, limit = 10) => {
    try {
      if (!aiEngineManager) {
        const { getAIEngineManager } = require('../ai-engine/ai-engine-manager');
        const manager = getAIEngineManager();
        await manager.initialize();
        return await manager.getTaskPlanner().getTaskPlanHistory(projectId, limit);
      }

      await aiEngineManager.initialize();
      return await aiEngineManager.getTaskPlanner().getTaskPlanHistory(projectId, limit);
    } catch (error) {
      console.error('[Main] 获取任务计划历史失败:', error);
      throw error;
    }
  });

  /**
   * 取消任务计划
   * Channel: 'project:cancel-task-plan'
   */
  ipcMain.handle('project:cancel-task-plan', async (_event, taskPlanId) => {
    try {
      if (!aiEngineManager) {
        const { getAIEngineManager } = require('../ai-engine/ai-engine-manager');
        const manager = getAIEngineManager();
        await manager.initialize();
        await manager.getTaskPlanner().cancelTaskPlan(taskPlanId);
        return { success: true };
      }

      await aiEngineManager.initialize();
      await aiEngineManager.getTaskPlanner().cancelTaskPlan(taskPlanId);
      return { success: true };
    } catch (error) {
      console.error('[Main] 取消任务计划失败:', error);
      throw error;
    }
  });

  // ============================================================
  // AI 内容处理 (Content Processing)
  // ============================================================

  /**
   * AI内容润色
   * Channel: 'project:polishContent'
   */
  ipcMain.handle('project:polishContent', async (_event, params) => {
    try {
      const { content, style } = params;
      console.log('[Main] AI内容润色');

      const prompt = `请对以下内容进行润色，使其更加专业、流畅：

${content}

要求：
1. 保持原意不变
2. 改进表达方式
3. 修正语法错误
4. 使用恰当的专业术语
${style ? `5. 风格：${style}` : ''}`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 3000
      });

      return {
        success: true,
        polished: response.text || response.content || response
      };
    } catch (error) {
      console.error('[Main] AI内容润色失败:', error);
      throw error;
    }
  });

  /**
   * AI内容扩写
   * Channel: 'project:expandContent'
   */
  ipcMain.handle('project:expandContent', async (_event, params) => {
    try {
      const { content, targetLength } = params;
      console.log('[Main] AI内容扩写');

      const prompt = `请扩展以下内容，增加更多细节和例子${targetLength ? `，目标字数约${targetLength}字` : ''}：

${content}

要求：
1. 保持原有观点和结构
2. 增加具体例子和数据支持
3. 使内容更加详实完整`;

      const response = await llmManager.query(prompt, {
        temperature: 0.7,
        maxTokens: 4000
      });

      return {
        success: true,
        expanded: response.text || response.content || response
      };
    } catch (error) {
      console.error('[Main] AI内容扩写失败:', error);
      throw error;
    }
  });

  // ============================================================
  // AI 代码助手 (Code Assistant)
  // ============================================================

  /**
   * 代码生成
   * Channel: 'project:code-generate'
   */
  ipcMain.handle('project:code-generate', async (_event, description, language, options = {}) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.generate(
        description,
        language,
        options.style || 'modern',
        options.includeTests || false,
        options.includeComments !== false,
        options.context
      );
    } catch (error) {
      console.error('[Main] 代码生成失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 代码审查
   * Channel: 'project:code-review'
   */
  ipcMain.handle('project:code-review', async (_event, code, language, focusAreas = null) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.review(code, language, focusAreas);
    } catch (error) {
      console.error('[Main] 代码审查失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 代码重构
   * Channel: 'project:code-refactor'
   */
  ipcMain.handle('project:code-refactor', async (_event, code, language, refactorType = 'general') => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.refactor(code, language, refactorType);
    } catch (error) {
      console.error('[Main] 代码重构失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 代码解释
   * Channel: 'project:code-explain'
   */
  ipcMain.handle('project:code-explain', async (_event, code, language) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.explain(code, language);
    } catch (error) {
      console.error('[Main] 代码解释失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Bug修复
   * Channel: 'project:code-fix-bug'
   */
  ipcMain.handle('project:code-fix-bug', async (_event, code, language, bugDescription) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.fixBug(code, language, bugDescription);
    } catch (error) {
      console.error('[Main] Bug修复失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 生成测试代码
   * Channel: 'project:code-generate-tests'
   */
  ipcMain.handle('project:code-generate-tests', async (_event, code, language) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.generateTests(code, language);
    } catch (error) {
      console.error('[Main] 生成测试失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 代码优化
   * Channel: 'project:code-optimize'
   */
  ipcMain.handle('project:code-optimize', async (_event, code, language) => {
    try {
      const CodeAPI = require('./code-api');
      return await CodeAPI.optimize(code, language);
    } catch (error) {
      console.error('[Main] 代码优化失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Project AI IPC] ✓ All Project AI IPC handlers registered successfully (15 handlers)');
}

module.exports = {
  registerProjectAIIPC
};
