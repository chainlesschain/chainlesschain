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
const path = require('path');

/**
 * 从AI响应中提取PPT大纲
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} PPT大纲对象，如果没有则返回null
 */
function extractPPTOutline(aiResponse) {
  try {
    // 查找PPT大纲标记
    const startMarker = '**[PPT_OUTLINE_START]**';
    const endMarker = '**[PPT_OUTLINE_END]**';

    const startIndex = aiResponse.indexOf(startMarker);
    const endIndex = aiResponse.indexOf(endMarker);

    if (startIndex === -1 || endIndex === -1) {
      console.log('[PPT Detector] 未找到PPT大纲标记');
      return null;
    }

    // 提取标记之间的内容
    const outlineSection = aiResponse.substring(
      startIndex + startMarker.length,
      endIndex
    );

    // 提取JSON
    const jsonMatch = outlineSection.match(/```json\s*([\s\S]*?)```/) ||
                      outlineSection.match(/```\s*([\s\S]*?)```/) ||
                      outlineSection.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      console.warn('[PPT Detector] 未找到JSON格式的大纲');
      return null;
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const outline = JSON.parse(jsonText);

    console.log('[PPT Detector] 成功提取PPT大纲:', outline.title);
    return outline;
  } catch (error) {
    console.error('[PPT Detector] 提取PPT大纲失败:', error);
    return null;
  }
}

/**
 * 生成PPT文件
 * @param {Object} outline - PPT大纲
 * @param {string} projectPath - 项目路径
 * @param {Object} project - 项目信息
 * @returns {Promise<Object>} 生成结果
 */
async function generatePPTFile(outline, projectPath, project) {
  try {
    const PPTEngine = require('../engines/ppt-engine');
    const pptEngine = new PPTEngine();

    // 生成PPT文件
    const outputPath = path.join(projectPath, `${outline.title || 'presentation'}.pptx`);

    console.log('[PPT Generator] 开始生成PPT:', outline.title);
    console.log('[PPT Generator] 输出路径:', outputPath);

    const result = await pptEngine.generateFromOutline(outline, {
      theme: 'business',
      author: project.user_id || '作者',
      outputPath: outputPath
    });

    console.log('[PPT Generator] PPT生成成功:', result.fileName);

    return {
      success: true,
      generated: true,
      filePath: result.path,
      fileName: result.fileName,
      slideCount: result.slideCount,
      theme: result.theme
    };
  } catch (error) {
    console.error('[PPT Generator] 生成PPT失败:', error);
    return {
      success: false,
      generated: false,
      error: error.message
    };
  }
}

/**
 * 检测Word文档生成请求
 * @param {string} userMessage - 用户消息
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} Word请求信息，如果没有则返回null
 */
function extractWordRequest(userMessage, aiResponse) {
  try {
    // 检测用户消息中的Word/docx关键词
    const userMsgLower = (userMessage || '').toLowerCase();
    const aiResponseLower = (aiResponse || '').toLowerCase();

    const wordKeywords = ['word', 'docx', 'doc文档', 'word文档', '生成文档', '创建文档'];
    const hasWordKeyword = wordKeywords.some(keyword =>
      userMsgLower.includes(keyword) || aiResponseLower.includes(keyword)
    );

    if (!hasWordKeyword) {
      console.log('[Word Detector] 未检测到Word生成请求');
      return null;
    }

    // 提取文档描述
    let description = userMessage;

    // 尝试提取更具体的描述
    const descPatterns = [
      /生成(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
      /创建(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
      /写(?:一个|一份)?(.+?)(?:的)?(?:word|docx|文档)/i,
    ];

    for (const pattern of descPatterns) {
      const match = userMessage.match(pattern);
      if (match && match[1]) {
        description = match[1].trim();
        break;
      }
    }

    console.log('[Word Detector] 检测到Word生成请求');
    console.log('[Word Detector] 文档描述:', description);

    return {
      description: description,
      format: 'docx'
    };
  } catch (error) {
    console.error('[Word Detector] 检测Word请求失败:', error);
    return null;
  }
}

/**
 * 生成Word文件
 * @param {Object} wordRequest - Word请求信息
 * @param {string} projectPath - 项目路径
 * @param {Object} llmManager - LLM管理器
 * @returns {Promise<Object>} 生成结果
 */
async function generateWordFile(wordRequest, projectPath, llmManager) {
  try {
    const wordEngine = require('../engines/word-engine');

    console.log('[Word Generator] 开始生成Word文档');
    console.log('[Word Generator] 描述:', wordRequest.description);
    console.log('[Word Generator] 项目路径:', projectPath);

    const result = await wordEngine.handleProjectTask({
      description: wordRequest.description,
      projectPath: projectPath,
      llmManager: llmManager,
      action: 'create_document'
    });

    console.log('[Word Generator] Word文档生成成功:', result.fileName);

    return {
      success: true,
      generated: true,
      filePath: result.filePath,
      fileName: result.fileName,
      fileSize: result.fileSize
    };
  } catch (error) {
    console.error('[Word Generator] 生成Word文档失败:', error);
    return {
      success: false,
      generated: false,
      error: error.message
    };
  }
}

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

      let projectPath = project.root_path;

      // 🔥 修复：如果项目路径不存在，自动创建（解决PPT生成失败问题）
      if (!projectPath) {
        console.warn('[Main] 项目路径未设置，自动创建项目目录');

        const fs = require('fs').promises;
        const { getProjectConfig } = require('../config/project-config');
        const projectConfig = getProjectConfig();

        // 使用项目名称或ID作为目录名
        const dirName = project.name ? project.name.replace(/[^\w\s-]/g, '_') : `project_${projectId}`;
        projectPath = path.join(projectConfig.getProjectsRootPath(), dirName);

        // 创建目录
        await fs.mkdir(projectPath, { recursive: true });
        console.log('[Main] 项目目录已自动创建:', projectPath);

        // 更新数据库中的项目路径
        database.db.prepare('UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?')
          .run(projectPath, Date.now(), projectId);

        console.log('[Main] 项目路径已更新到数据库');
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
        const systemPrompt = `你是一个智能项目助手，正在协助用户处理项目: ${project.name}。
当前上下文模式: ${contextMode || 'project'}
${currentFilePath ? `当前文件: ${currentFilePath}` : ''}

## 🎯 重要：PPT生成特殊指令（最高优先级）

**检测规则**：如果用户消息包含以下任一关键词，必须生成PPT大纲：
- "PPT" / "ppt"
- "幻灯片"
- "演示文稿" / "演示"
- "presentation"

**必须输出格式**（严格遵守）：

第一步：立即输出JSON大纲（必须使用标记包裹）

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "PPT标题（必填，20字以内）",
  "subtitle": "副标题（可选）",
  "sections": [
    {
      "title": "第一章节（必填）",
      "subsections": [
        {
          "title": "子主题1（必填）",
          "points": ["要点1（3-5个要点）", "要点2", "要点3"]
        },
        {
          "title": "子主题2",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    },
    {
      "title": "第二章节",
      "subsections": [
        {
          "title": "子主题",
          "points": ["要点1", "要点2", "要点3"]
        }
      ]
    }
  ]
}
\`\`\`
**[PPT_OUTLINE_END]**

第二步：在大纲下方提供文字说明（可选）

**示例**：
用户："做一个新年致辞PPT"

你的回答必须是：

**[PPT_OUTLINE_START]**
\`\`\`json
{
  "title": "2026新年致辞",
  "subtitle": "迎接新征程",
  "sections": [
    {
      "title": "回顾2025",
      "subsections": [
        {
          "title": "年度成就",
          "points": ["业绩突破历史新高", "团队规模扩大50%", "产品获行业大奖"]
        }
      ]
    },
    {
      "title": "展望2026",
      "subsections": [
        {
          "title": "战略目标",
          "points": ["市场份额增长30%", "推出3款新产品", "拓展海外市场"]
        }
      ]
    },
    {
      "title": "致谢与祝福",
      "subsections": [
        {
          "title": "感谢团队",
          "points": ["感谢全体员工辛勤付出", "感谢合作伙伴信任支持", "祝愿大家新年快乐"]
        }
      ]
    }
  ]
}
\`\`\`
**[PPT_OUTLINE_END]**

我已为您生成了新年致辞PPT大纲，包含3个章节：回顾2025、展望2026、致谢与祝福。系统将自动生成.pptx文件并保存到项目目录。

---

对于非PPT请求，正常回答即可。请根据用户的问题提供有帮助的回答。`;

        messages.push({
          role: 'system',
          content: systemPrompt
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
        if (toolsToUse.length > 0 && llmManager.toolsClient && llmManager.provider === 'volcengine') {
          console.log('[Main] 项目AI对话使用工具调用:', toolsToUse.join(', '));

          if (toolsToUse.includes('web_search')) {
            // 使用联网搜索（仅火山引擎支持）
            try {
              const toolResult = await llmManager.chatWithWebSearch(messages, {
                ...chatOptions,
                searchMode: 'auto',
              });

              // 转换为统一格式
              llmResult = {
                content: toolResult.choices?.[0]?.message?.content || '',
                text: toolResult.choices?.[0]?.message?.content || '',
              };
            } catch (toolError) {
              console.warn('[Main] 工具调用失败，降级到标准对话:', toolError.message);
              llmResult = await llmManager.chat(messages, chatOptions);
            }
          }
        } else {
          // 标准对话（不支持工具调用或非火山引擎）
          if (toolsToUse.length > 0) {
            console.warn('[Main] 当前LLM提供商不支持工具调用，使用标准对话');
          }
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

        // 🔥 检测并生成PPT（桥接器分支）
        let pptResult = null;
        try {
          const pptOutline = extractPPTOutline(aiResponse);
          if (pptOutline) {
            console.log('[Main] 🎨 检测到PPT生成请求（桥接器分支）...');
            pptResult = await generatePPTFile(pptOutline, projectPath, project);

            if (pptResult.success && scanAndRegisterProjectFiles) {
              await scanAndRegisterProjectFiles(projectId, projectPath);
            }
          }
        } catch (pptError) {
          console.error('[Main] PPT处理出错（桥接器分支）:', pptError);
        }

        // 🔥 检测并生成Word文档（桥接器分支）
        let wordResult = null;
        try {
          const wordRequest = extractWordRequest(userMessage, aiResponse);
          if (wordRequest) {
            console.log('[Main] 📝 检测到Word文档生成请求（桥接器分支）...');
            wordResult = await generateWordFile(wordRequest, projectPath, llmManager);

            if (wordResult.success && scanAndRegisterProjectFiles) {
              await scanAndRegisterProjectFiles(projectId, projectPath);
            }
          }
        } catch (wordError) {
          console.error('[Main] Word处理出错（桥接器分支）:', wordError);
        }

        return {
          success: true,
          conversationResponse: bridgeResult.enhancedResponse,
          fileOperations: bridgeResult.executionResults || [],
          ragSources: rag_sources || [],
          hasFileOperations: bridgeResult.toolCalls.length > 0,
          usedBridge: true,
          useLocalLLM: useLocalLLM,
          toolCalls: bridgeResult.toolCalls,
          bridgeSummary: bridgeResult.summary,
          // 🔥 新增：PPT生成结果
          pptGenerated: pptResult?.generated || false,
          pptResult: pptResult,
          // 🔥 新增：Word生成结果
          wordGenerated: wordResult?.generated || false,
          wordResult: wordResult
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

      // 10. 检测并生成PPT（如果AI响应包含PPT大纲）
      let pptResult = null;
      try {
        const pptOutline = extractPPTOutline(aiResponse);

        if (pptOutline) {
          console.log('[Main] 🎨 检测到PPT生成请求，开始生成PPT文件...');
          pptResult = await generatePPTFile(pptOutline, projectPath, project);

          if (pptResult.success) {
            console.log('[Main] ✅ PPT文件已生成:', pptResult.fileName);

            // 将生成的PPT文件添加到项目文件列表（可选）
            if (scanAndRegisterProjectFiles) {
              try {
                await scanAndRegisterProjectFiles(projectId, projectPath);
                console.log('[Main] PPT文件已注册到项目');
              } catch (scanError) {
                console.warn('[Main] 注册PPT文件失败:', scanError.message);
              }
            }
          } else {
            console.error('[Main] ❌ PPT生成失败:', pptResult.error);
          }
        }
      } catch (pptError) {
        console.error('[Main] PPT处理出错:', pptError);
        pptResult = {
          success: false,
          generated: false,
          error: pptError.message
        };
      }

      // 10.5 检测并生成Word文档（如果用户请求生成Word文档）
      let wordResult = null;
      try {
        const wordRequest = extractWordRequest(userMessage, aiResponse);

        if (wordRequest) {
          console.log('[Main] 📝 检测到Word文档生成请求，开始生成Word文件...');
          wordResult = await generateWordFile(wordRequest, projectPath, llmManager);

          if (wordResult.success) {
            console.log('[Main] ✅ Word文档已生成:', wordResult.fileName);

            // 将生成的Word文件添加到项目文件列表（可选）
            if (scanAndRegisterProjectFiles) {
              try {
                await scanAndRegisterProjectFiles(projectId, projectPath);
                console.log('[Main] Word文件已注册到项目');
              } catch (scanError) {
                console.warn('[Main] 注册Word文件失败:', scanError.message);
              }
            }
          } else {
            console.error('[Main] ❌ Word生成失败:', wordResult.error);
          }
        }
      } catch (wordError) {
        console.error('[Main] Word处理出错:', wordError);
        wordResult = {
          success: false,
          generated: false,
          error: wordError.message
        };
      }

      // 11. 返回结果
      return {
        success: true,
        conversationResponse: aiResponse,
        fileOperations: operationResults,
        ragSources: rag_sources || [],
        hasFileOperations: !useLocalLLM && parsed.hasFileOperations,
        usedBridge: false,
        useLocalLLM: useLocalLLM,
        // 🔥 新增：PPT生成结果
        pptGenerated: pptResult?.generated || false,
        pptResult: pptResult,
        // 🔥 新增：Word生成结果
        wordGenerated: wordResult?.generated || false,
        wordResult: wordResult
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

  /**
   * 项目AI对话（流式） - 支持文件操作和流式输出
   * Channel: 'project:aiChatStream'
   */
  ipcMain.handle('project:aiChatStream', async (_event, chatData) => {
    try {
      console.log('[Main] 项目AI对话（流式）:', chatData);

      const {
        projectId,
        userMessage,
        conversationHistory,
        contextMode,
        currentFile,
        projectInfo,
        fileList,
        options = {}
      } = chatData;

      // 1. 检查数据库
      if (!database) {
        throw new Error('数据库未初始化');
      }

      // 2. 检查LLM管理器
      if (!llmManager) {
        throw new Error('LLM管理器未初始化，请在设置中配置LLM服务');
      }

      // 3. 获取当前窗口（动态获取，避免引用过期）
      const { BrowserWindow } = require('electron');
      const currentWindow = mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find(w => !w.isDestroyed());

      if (!currentWindow) {
        throw new Error('没有可用的窗口发送流式消息');
      }

      // 4. 获取项目信息
      const project = database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

      if (!project) {
        throw new Error(`项目不存在: ${projectId}`);
      }

      let projectPath = project.root_path;

      // 🔥 修复：如果项目路径不存在，自动创建
      if (!projectPath) {
        console.warn('[Main] 项目路径未设置（流式），自动创建项目目录');

        const fs = require('fs').promises;
        const { getProjectConfig } = require('../config/project-config');
        const projectConfig = getProjectConfig();

        // 使用项目名称或ID作为目录名
        const dirName = project.name ? project.name.replace(/[^\w\s-]/g, '_') : `project_${projectId}`;
        projectPath = path.join(projectConfig.getProjectsRootPath(), dirName);

        // 创建目录
        await fs.mkdir(projectPath, { recursive: true });
        console.log('[Main] 项目目录已自动创建:', projectPath);

        // 更新数据库中的项目路径
        database.db.prepare('UPDATE projects SET root_path = ?, updated_at = ? WHERE id = ?')
          .run(projectPath, Date.now(), projectId);

        console.log('[Main] 项目路径已更新到数据库');
      }

      console.log('[Main] 项目路径:', projectPath);

      // 5. 构建消息列表
      const messages = [];

      // 添加系统提示
      messages.push({
        role: 'system',
        content: `你是一个智能项目助手，正在协助用户处理项目: ${project.name}。
当前上下文模式: ${contextMode || 'project'}
${currentFile ? `当前文件: ${currentFile}` : ''}

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

      console.log('[Main] 使用流式LLM，消息数量:', messages.length);

      // 6. 创建流式控制器
      const { createStreamController } = require('../llm/stream-controller');
      const streamController = createStreamController({
        enableBuffering: true
      });

      streamController.start();

      // 7. 准备响应累积
      let fullResponse = '';
      let totalTokens = 0;
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // 8. 定义chunk回调函数
      const onChunk = async (chunk) => {
        console.log('[Main] 📥 收到 LLM chunk:', JSON.stringify(chunk).substring(0, 100));

        // 处理chunk
        const shouldContinue = await streamController.processChunk(chunk);
        if (!shouldContinue) {
          console.log('[Main] ⏸️  Stream controller 指示停止');
          return false;
        }

        // 提取chunk内容
        const chunkContent = chunk.content || chunk.text || chunk.delta?.content || '';
        console.log('[Main] 📝 提取的 chunk 内容长度:', chunkContent.length);

        if (chunkContent) {
          fullResponse += chunkContent;

          // 发送chunk给前端
          console.log('[Main] 📤 发送 chunk 到前端，完整内容长度:', fullResponse.length);
          currentWindow.webContents.send('project:aiChatStream-chunk', {
            projectId,
            messageId,
            chunk: chunkContent,
            fullContent: fullResponse
          });
        }

        // 更新tokens
        if (chunk.usage) {
          totalTokens = chunk.usage.total_tokens || 0;
        }

        return true;
      };

      // 9. 智能选择模型（如果是火山引擎）
      const chatOptions = {
        temperature: 0.7,
        maxTokens: 2000,
        ...options
      };

      if (llmManager.provider === 'volcengine') {
        try {
          // 根据项目类型和对话内容智能选择模型
          const scenario = {
            userBudget: 'medium',
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
            if (/(分析|推理|思考|为什么|如何|怎么)/.test(userMessage)) {
              scenario.needsThinking = true;
              console.log('[Main] 检测到需要深度思考');
            }
          }

          // 智能选择模型
          const selectedModel = llmManager.selectVolcengineModel(scenario);
          if (selectedModel) {
            chatOptions.model = selectedModel.modelId;
            console.log('[Main] 项目AI对话（流式）智能选择模型:', selectedModel.modelName);
          }
        } catch (selectError) {
          console.warn('[Main] 智能模型选择失败，使用默认配置:', selectError.message);
        }
      }

      // 10. 调用LLM流式对话
      try {
        console.log('[Main] 🚀 开始调用 llmManager.chatStream');
        const llmResult = await llmManager.chatStream(messages, onChunk, chatOptions);

        console.log('[Main] ✅ 流式对话完成，总长度:', fullResponse.length);

        // 11. 通知前端完成
        streamController.complete({
          messageId,
          tokens: totalTokens || llmResult.tokens
        });

        currentWindow.webContents.send('project:aiChatStream-complete', {
          projectId,
          messageId,
          fullContent: fullResponse,
          tokens: totalTokens || llmResult.tokens,
          stats: streamController.getStats()
        });

        return {
          success: true,
          messageId,
          tokens: totalTokens || llmResult.tokens,
          response: fullResponse
        };

      } catch (llmError) {
        console.error('[Main] LLM流式对话失败:', llmError);

        // 通知前端错误
        streamController.error(llmError);

        currentWindow.webContents.send('project:aiChatStream-error', {
          projectId,
          messageId,
          error: llmError.message
        });

        throw llmError;
      }

    } catch (error) {
      console.error('[Main] 项目AI对话（流式）失败:', error);

      // 提供更友好的错误信息
      if (error.message.includes('LLM管理器未初始化')) {
        throw new Error('AI功能未配置，请在设置中配置LLM服务（Ollama或云端API）');
      }

      throw error;
    }
  });

  // ============================================================
  // 意图理解功能 (Intent Understanding)
  // ============================================================

  /**
   * 理解用户意图 - 纠错 + 意图识别
   * Channel: 'project:understandIntent'
   */
  ipcMain.handle('project:understandIntent', async (_event, data) => {
    try {
      console.log('[Main] 开始理解用户意图:', data);

      const { userInput, projectId, contextMode } = data;

      if (!userInput || !userInput.trim()) {
        throw new Error('用户输入不能为空');
      }

      // 检查LLM管理器
      if (!llmManager) {
        throw new Error('LLM管理器未初始化');
      }

      // 构建意图理解的提示词
      const systemPrompt = `你是一个智能的意图理解助手。你的任务是：

1. **纠错处理**：识别并纠正用户输入中的打字错误、拼写错误、语法错误等问题
2. **意图识别**：理解用户的真实意图和需求
3. **要点提取**：提取用户需求的关键要点

请以JSON格式返回结果，格式如下：
\`\`\`json
{
  "correctedInput": "纠错后的输入（如果没有错误，则与原输入相同）",
  "intent": "用户的意图描述（简短的一句话）",
  "keyPoints": ["关键要点1", "关键要点2", "关键要点3"]
}
\`\`\`

**注意事项：**
- 如果输入没有错误，correctedInput应该与原输入完全相同
- intent应该简洁明了，不超过30个字
- keyPoints应该提取3-5个核心要点
- 必须返回有效的JSON格式`;

      const userPrompt = `请理解以下用户输入：

用户输入：${userInput}

上下文模式：${contextMode || 'project'}`;

      // 调用LLM进行意图理解
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      console.log('[Main] 调用LLM进行意图理解...');
      const llmResult = await llmManager.chat(messages, {
        temperature: 0.3,  // 较低的温度以获得更准确的结果
        maxTokens: 500
      });

      console.log('[Main] LLM响应:', llmResult.content);

      // 解析LLM响应
      let understanding;
      try {
        // 提取JSON部分
        const jsonMatch = llmResult.content.match(/```json\s*([\s\S]*?)```/) ||
                          llmResult.content.match(/```\s*([\s\S]*?)```/) ||
                          llmResult.content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          throw new Error('LLM响应中未找到JSON格式的理解结果');
        }

        const jsonText = jsonMatch[1] || jsonMatch[0];
        understanding = JSON.parse(jsonText);

        // 验证必要字段
        if (!understanding.correctedInput) {
          understanding.correctedInput = userInput;
        }
        if (!understanding.intent) {
          understanding.intent = '未能识别意图';
        }
        if (!Array.isArray(understanding.keyPoints)) {
          understanding.keyPoints = [];
        }

        console.log('[Main] 意图理解成功:', understanding);

        return {
          success: true,
          ...understanding
        };

      } catch (parseError) {
        console.error('[Main] 解析LLM响应失败:', parseError);

        // 如果解析失败，返回默认结果
        return {
          success: true,
          correctedInput: userInput,
          intent: '理解用户需求并提供帮助',
          keyPoints: [userInput.slice(0, 50) + (userInput.length > 50 ? '...' : '')]
        };
      }

    } catch (error) {
      console.error('[Main] 意图理解失败:', error);
      throw error;
    }
  });

  console.log('[Project AI IPC] ✓ All Project AI IPC handlers registered successfully (17 handlers)');
}

module.exports = {
  registerProjectAIIPC
};
