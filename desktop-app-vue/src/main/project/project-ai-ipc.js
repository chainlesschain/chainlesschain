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

      // 5. 尝试调用后端AI服务，如果失败则使用本地LLM
      const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8001';
      let aiResponse = null;
      let operations = [];
      let rag_sources = [];
      let useLocalLLM = false;

      try {
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

        console.log('[Main] 尝试连接后端AI服务:', AI_SERVICE_URL);

        const response = await axios.post(
          `${AI_SERVICE_URL}/api/projects/${projectId}/chat`,
          requestData,
          {
            timeout: 5000  // 5秒超时，快速失败
          }
        );

        const responseData = response.data;
        aiResponse = responseData.response;
        operations = responseData.operations || [];
        rag_sources = responseData.rag_sources || [];

        console.log('[Main] 后端AI服务响应成功');
      } catch (backendError) {
        console.warn('[Main] 后端AI服务不可用，切换到本地LLM:', backendError.message);
        useLocalLLM = true;

        // 使用本地LLM管理器
        if (!llmManager) {
          throw new Error('LLM管理器未初始化，无法使用本地AI功能');
        }

        // 构建对话上下文
        const messages = [];

        // 添加系统提示
        messages.push({
          role: 'system',
          content: `你是一个智能项目助手，正在协助用户处理项目: ${project.name}。
当前上下文模式: ${contextMode || 'project'}
${currentFilePath ? `当前文件: ${currentFilePath}` : ''}

请根据用户的问题提供有帮助的回答。`
        });

        // 添加对话历史
        if (conversationHistory && Array.isArray(conversationHistory)) {
          messages.push(...conversationHistory);
        }

        // 添加用户消息
        messages.push({
          role: 'user',
          content: userMessage
        });

        console.log('[Main] 使用本地LLM，消息数量:', messages.length);

        // 🔥 火山引擎智能模型选择 + 工具调用（根据项目类型和对话场景）
        const chatOptions = {
          temperature: 0.7,
          maxTokens: 2000
        };

        let useToolCalling = false;
        let toolsToUse = [];

        if (llmManager.provider === 'volcengine') {
          try {
            // 根据项目类型和对话内容智能选择模型
            const scenario = {
              userBudget: 'medium',  // 默认中等预算
            };

            // 根据项目类型调整场景
            const projectType = project.project_type;
            if (projectType === 'code' || projectType === 'app' || projectType === 'web') {
              scenario.needsCodeGeneration = true;
              console.log('[Main] 检测到代码项目，启用代码生成模式');
            }

            // 根据上下文模式调整
            if (contextMode === 'file' || contextMode === 'project') {
              scenario.needsLongContext = true;
              console.log('[Main] 检测到需要长上下文（项目/文件模式）');
            }

            // 分析用户消息内容
            if (userMessage) {
              // 检测深度思考需求
              if (/(分析|推理|思考|为什么|如何|怎么)/.test(userMessage)) {
                scenario.needsThinking = true;
                console.log('[Main] 检测到需要深度思考');
              }

              // 🔥 检测是否需要联网搜索
              if (/(最新|今天|现在|实时|新闻|API文档|库文档|框架文档|技术文档)/.test(userMessage)) {
                toolsToUse.push('web_search');
                console.log('[Main] 检测到需要联网搜索（获取最新文档/信息）');
              }
            }

            // 智能选择模型
            const selectedModel = llmManager.selectVolcengineModel(scenario);
            if (selectedModel) {
              chatOptions.model = selectedModel.modelId;
              console.log('[Main] 项目AI对话智能选择模型:', selectedModel.modelName);
              console.log('[Main] 预估成本: ¥', llmManager.estimateCost(
                selectedModel.modelId,
                messages.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4, // 粗略估计tokens
                500, // 预估输出500 tokens
                0
              ).toFixed(4));
            }
          } catch (selectError) {
            console.warn('[Main] 智能模型选择失败，使用默认配置:', selectError.message);
          }
        }

        // 调用本地LLM（根据是否需要工具调用选择不同方法）
        let llmResult;
        if (toolsToUse.length > 0 && llmManager.toolsClient) {
          console.log('[Main] 项目AI对话使用工具调用:', toolsToUse.join(', '));

          if (toolsToUse.includes('web_search')) {
            // 使用联网搜索
            const toolResult = await llmManager.chatWithWebSearch(messages, {
              ...chatOptions,
              searchMode: 'auto',
            });

            // 转换为统一格式
            llmResult = {
              content: toolResult.choices?.[0]?.message?.content || '',
              text: toolResult.choices?.[0]?.message?.content || '',
            };
          }
        } else {
          // 标准对话
          llmResult = await llmManager.chat(messages, chatOptions);
        }

        aiResponse = llmResult.content || llmResult.text || llmResult;
        console.log('[Main] 本地LLM响应成功');
      }

      console.log('[Main] AI响应:', aiResponse);
      console.log('[Main] 文件操作数量:', operations ? operations.length : 0);
      console.log('[Main] 使用本地LLM:', useLocalLLM);

      // 6. 使用ChatSkillBridge拦截并处理
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

      // 7. 如果桥接器成功处理，返回增强响应
      if (bridgeResult && bridgeResult.shouldIntercept) {
        console.log('[Main] 使用桥接器处理结果');
        return {
          success: true,
          conversationResponse: bridgeResult.enhancedResponse,
          fileOperations: bridgeResult.executionResults || [],
          ragSources: rag_sources || [],
          hasFileOperations: bridgeResult.toolCalls.length > 0,
          usedBridge: true,
          useLocalLLM: useLocalLLM,
          toolCalls: bridgeResult.toolCalls,
          bridgeSummary: bridgeResult.summary
        };
      }

      // 8. 否则使用原有的解析逻辑
      console.log('[Main] 使用原有解析逻辑');
      const parsed = parseAIResponse(aiResponse, operations);

      // 9. 执行文件操作（仅当使用后端服务时才执行文件操作）
      let operationResults = [];
      if (!useLocalLLM && parsed.hasFileOperations) {
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

      // 10. 返回结果
      return {
        success: true,
        conversationResponse: aiResponse,
        fileOperations: operationResults,
        ragSources: rag_sources || [],
        hasFileOperations: !useLocalLLM && parsed.hasFileOperations,
        usedBridge: false,
        useLocalLLM: useLocalLLM
      };

    } catch (error) {
      console.error('[Main] 项目AI对话失败:', error);

      // 提供更友好的错误信息
      if (error.message.includes('LLM管理器未初始化')) {
        throw new Error('AI功能未配置，请在设置中配置LLM服务（Ollama或云端API）');
      }

      if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
        throw new Error('后端AI服务未运行，已尝试使用本地LLM但配置不正确');
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
