/**
 * AI任务智能拆解系统（增强版）
 *
 * 核心功能：
 * 1. 使用LLM智能拆解用户需求为可执行的子任务
 * 2. 支持依赖关系解析和并行执行
 * 3. 实时执行和状态更新
 * 4. 与各种引擎集成（Web/Document/Data/PPT等）
 * 5. 持久化到数据库
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const EventEmitter = require("events");
const os = require("os");
const { SmartPlanCache } = require("./smart-plan-cache.js");

/**
 * 质量门禁检查器
 * 在任务计划执行前进行并行质量检查
 */
class QualityGateChecker {
  constructor(options = {}) {
    this.availableTools = options.availableTools || [];
    this.maxConcurrency = options.maxConcurrency || 8;
    this.maxMemoryUsage = options.maxMemoryUsage || 0.85; // 85%
    this.enabled = options.enabled !== false;

    this.stats = {
      totalChecks: 0,
      passed: 0,
      failed: 0,
      warnings: 0,
    };
  }

  /**
   * 执行所有质量门禁检查（并行）
   */
  async runAllGates(taskPlan) {
    if (!this.enabled) {
      logger.info("[QualityGate] 质量门禁检查已禁用");
      return { passed: true, gates: [], warnings: [] };
    }

    logger.info("[QualityGate] 开始并行质量门禁检查...");
    this.stats.totalChecks++;

    const startTime = Date.now();

    // 并行执行所有质量门禁
    const gateResults = await Promise.allSettled([
      this.checkCyclicDependencies(taskPlan),
      this.checkResourceFeasibility(taskPlan),
      this.checkToolAvailability(taskPlan),
      this.checkParameterCompleteness(taskPlan),
    ]);

    const duration = Date.now() - startTime;

    // 汇总结果
    const results = {
      passed: true,
      gates: [],
      warnings: [],
      errors: [],
      duration,
    };

    gateResults.forEach((result, index) => {
      const gateName = ["循环依赖", "资源评估", "工具可用性", "参数完整性"][
        index
      ];

      if (result.status === "fulfilled") {
        const gateResult = result.value;
        results.gates.push({ name: gateName, ...gateResult });

        if (!gateResult.passed) {
          results.passed = false;
          results.errors.push(`${gateName}检查失败: ${gateResult.message}`);
        }

        if (gateResult.warnings && gateResult.warnings.length > 0) {
          results.warnings.push(
            ...gateResult.warnings.map((w) => `[${gateName}] ${w}`),
          );
          this.stats.warnings += gateResult.warnings.length;
        }
      } else {
        // 门禁检查本身失败
        results.warnings.push(`${gateName}检查异常: ${result.reason.message}`);
        logger.warn(`[QualityGate] ${gateName}检查异常:`, result.reason);
      }
    });

    // 更新统计
    if (results.passed) {
      this.stats.passed++;
      logger.info(`[QualityGate] ✅ 所有质量门禁检查通过 (${duration}ms)`);
    } else {
      this.stats.failed++;
      logger.error(
        `[QualityGate] ❌ 质量门禁检查失败 (${duration}ms):`,
        results.errors,
      );
    }

    if (results.warnings.length > 0) {
      logger.warn("[QualityGate] ⚠️ 质量门禁警告:", results.warnings);
    }

    return results;
  }

  /**
   * 门禁1: 检测循环依赖
   */
  async checkCyclicDependencies(taskPlan) {
    logger.debug("[QualityGate] 检查循环依赖...");

    const { subtasks } = taskPlan;
    if (!subtasks || subtasks.length === 0) {
      return { passed: true, message: "无子任务，跳过检查" };
    }

    // 构建依赖图
    const graph = new Map();
    for (const task of subtasks) {
      graph.set(task.step, task.dependencies || []);
    }

    // DFS检测环
    const visited = new Set();
    const recursionStack = new Set();

    const hasCycle = (node) => {
      if (recursionStack.has(node)) {
        return true; // 发现环
      }

      if (visited.has(node)) {
        return false;
      }

      visited.add(node);
      recursionStack.add(node);

      const dependencies = graph.get(node) || [];
      for (const dep of dependencies) {
        if (hasCycle(dep)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    // 检查所有节点
    for (const node of graph.keys()) {
      if (hasCycle(node)) {
        return {
          passed: false,
          message: `检测到循环依赖，涉及步骤: ${node}`,
        };
      }
    }

    return {
      passed: true,
      message: `无循环依赖（${subtasks.length}个子任务）`,
    };
  }

  /**
   * 门禁2: 评估资源合理性
   */
  async checkResourceFeasibility(taskPlan) {
    logger.debug("[QualityGate] 评估资源合理性...");

    const { subtasks } = taskPlan;
    if (!subtasks || subtasks.length === 0) {
      return { passed: true, message: "无子任务，跳过检查" };
    }

    const warnings = [];

    // 检查并发数是否合理
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = (totalMem - freeMem) / totalMem;

    if (memUsage > this.maxMemoryUsage) {
      warnings.push(
        `内存使用率过高 (${(memUsage * 100).toFixed(1)}% > ${(this.maxMemoryUsage * 100).toFixed(0)}%)`,
      );
    }

    // 检查并发数
    const estimatedConcurrency = Math.min(subtasks.length, this.maxConcurrency);
    const cpuCores = os.cpus().length;

    if (estimatedConcurrency > cpuCores * 2) {
      warnings.push(
        `建议并发数(${estimatedConcurrency})超过CPU核心数(${cpuCores})的2倍`,
      );
    }

    // 预估内存消耗（每个任务约100MB）
    const estimatedMemoryMB = subtasks.length * 100;
    const freeMemMB = freeMem / 1024 / 1024;

    if (estimatedMemoryMB > freeMemMB * 0.5) {
      warnings.push(
        `预估内存消耗(${estimatedMemoryMB.toFixed(0)}MB)可能超过可用内存(${freeMemMB.toFixed(0)}MB)的50%`,
      );
    }

    return {
      passed: true,
      message: `资源评估完成 (${subtasks.length}任务, 预估${estimatedConcurrency}并发)`,
      warnings,
      metadata: {
        memUsage: (memUsage * 100).toFixed(1) + "%",
        estimatedConcurrency,
        cpuCores,
        freeMemMB: freeMemMB.toFixed(0),
      },
    };
  }

  /**
   * 门禁3: 验证工具可用性
   */
  async checkToolAvailability(taskPlan) {
    logger.debug("[QualityGate] 验证工具可用性...");

    const { subtasks } = taskPlan;
    if (!subtasks || subtasks.length === 0) {
      return { passed: true, message: "无子任务，跳过检查" };
    }

    const requiredTools = new Set();
    const missingTools = [];

    // 收集所有需要的工具
    for (const task of subtasks) {
      if (task.tool) {
        requiredTools.add(task.tool);
      }
    }

    // 检查工具是否可用
    for (const tool of requiredTools) {
      // 如果有可用工具列表，检查是否在列表中
      if (
        this.availableTools.length > 0 &&
        !this.availableTools.includes(tool)
      ) {
        missingTools.push(tool);
      }
    }

    if (missingTools.length > 0) {
      return {
        passed: false,
        message: `缺少必需工具: ${missingTools.join(", ")}`,
        metadata: {
          required: Array.from(requiredTools),
          missing: missingTools,
        },
      };
    }

    return {
      passed: true,
      message: `所有工具可用 (${requiredTools.size}个工具)`,
      metadata: {
        tools: Array.from(requiredTools),
      },
    };
  }

  /**
   * 门禁4: 检查参数完整性
   */
  async checkParameterCompleteness(taskPlan) {
    logger.debug("[QualityGate] 检查参数完整性...");

    const { subtasks } = taskPlan;
    if (!subtasks || subtasks.length === 0) {
      return { passed: true, message: "无子任务，跳过检查" };
    }

    const warnings = [];
    const incompleteTasks = [];

    for (const task of subtasks) {
      const issues = [];

      // 检查必需字段
      if (!task.step) {
        issues.push("缺少step");
      }
      if (!task.title) {
        issues.push("缺少title");
      }
      if (!task.tool && !task.action) {
        issues.push("缺少tool或action");
      }

      // 检查依赖引用
      if (task.dependencies && task.dependencies.length > 0) {
        for (const depStep of task.dependencies) {
          const depExists = subtasks.some((t) => t.step === depStep);
          if (!depExists) {
            issues.push(`依赖步骤${depStep}不存在`);
          }
        }
      }

      if (issues.length > 0) {
        incompleteTasks.push({
          step: task.step,
          title: task.title || "未命名",
          issues,
        });
      }
    }

    if (incompleteTasks.length > 0) {
      return {
        passed: false,
        message: `${incompleteTasks.length}个子任务参数不完整`,
        metadata: {
          incompleteTasks,
        },
      };
    }

    return {
      passed: true,
      message: `所有参数完整 (${subtasks.length}个子任务)`,
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      passRate:
        this.stats.totalChecks > 0
          ? ((this.stats.passed / this.stats.totalChecks) * 100).toFixed(2)
          : "0.00",
    };
  }

  /**
   * 重置统计
   */
  reset() {
    this.stats = {
      totalChecks: 0,
      passed: 0,
      failed: 0,
      warnings: 0,
    };
  }
}

class TaskPlannerEnhanced extends EventEmitter {
  constructor(dependencies) {
    super();

    // 依赖注入
    this.llmManager = dependencies.llmManager;
    this.database = dependencies.database;
    this.projectConfig = dependencies.projectConfig;

    // 引擎延迟加载（避免循环依赖）
    this.engines = {};

    // 质量门禁检查器
    this.qualityGateChecker = new QualityGateChecker({
      availableTools: dependencies.availableTools || [],
      enabled: dependencies.enableQualityGates !== false, // 默认启用
    });
    logger.info("[TaskPlannerEnhanced] 质量门禁检查器已初始化");

    // 智能计划缓存
    this.planCache = new SmartPlanCache({
      maxSize: dependencies.planCacheMaxSize || 1000,
      similarityThreshold: dependencies.planCacheSimilarity || 0.85,
      ttl: dependencies.planCacheTTL || 7 * 24 * 60 * 60 * 1000, // 7天
      enabled: dependencies.enablePlanCache !== false, // 默认启用
      llmManager: this.llmManager, // 用于embedding
    });
    logger.info("[TaskPlannerEnhanced] 智能计划缓存已初始化");
  }

  /**
   * 加载引擎
   */
  loadEngine(engineName) {
    if (!this.engines[engineName]) {
      try {
        const enginePath = path.join(
          __dirname,
          "..",
          "engines",
          `${engineName}.js`,
        );
        const EngineModule = require(enginePath);

        // 检查导出的是类还是实例
        if (typeof EngineModule === "function") {
          // 如果是类（构造函数），则实例化
          this.engines[engineName] = new EngineModule();
        } else if (typeof EngineModule === "object" && EngineModule !== null) {
          // 如果是对象（已实例化），则直接使用
          this.engines[engineName] = EngineModule;
        } else {
          throw new Error(`引擎模块格式不正确: ${engineName}`);
        }

        logger.info(`[TaskPlannerEnhanced] 加载引擎: ${engineName}`);
      } catch (error) {
        logger.error(
          `[TaskPlannerEnhanced] 加载引擎失败 ${engineName}:`,
          error,
        );
        throw new Error(`引擎 ${engineName} 不存在或加载失败`);
      }
    }
    return this.engines[engineName];
  }

  /**
   * 智能拆解任务
   * @param {string} userRequest - 用户需求描述
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} 任务计划
   */
  async decomposeTask(userRequest, projectContext = {}) {
    logger.info("[TaskPlannerEnhanced] 开始拆解任务:", userRequest);

    try {
      // 0. 智能缓存检查（优先级最高）
      const cachedPlan = await this.planCache.get(userRequest);
      if (cachedPlan) {
        logger.info("[TaskPlannerEnhanced] ✅ 缓存命中，直接返回计划");
        // 添加缓存标记
        return {
          ...cachedPlan,
          fromCache: true,
          cacheStats: this.planCache.getStats(),
        };
      }

      // 1. RAG增强: 检索相关上下文
      let ragContext = null;
      if (projectContext.projectId && projectContext.enableRAG !== false) {
        ragContext = await this.retrieveRAGContext(userRequest, projectContext);
      }

      // 2. 构建拆解提示词(异步,集成RAG上下文)
      const prompt = await this.buildDecomposePrompt(
        userRequest,
        projectContext,
        ragContext,
      );

      // 3. ⚡ 多层降级策略: 调用LLM生成任务计划
      let response;
      let taskPlan;

      // 尝试1: 主LLM（本地Ollama或配置的主LLM）
      try {
        logger.info("[TaskPlannerEnhanced] 尝试1: 主LLM");
        response = await this.llmManager.query(prompt, {
          systemPrompt:
            "你是一个专业的项目管理AI助手，擅长将用户需求拆解为清晰、可执行的步骤。你必须返回标准的JSON格式。",
          temperature: 0.3,
          maxTokens: 2000,
        });

        taskPlan = JSON.parse(this.cleanAndFixJSON(response.text));
        logger.info("[TaskPlannerEnhanced] ✅ 主LLM成功");
      } catch (error1) {
        logger.warn("[TaskPlannerEnhanced] 主LLM失败:", error1.message);

        // 尝试2: 修复JSON格式错误
        if (response && response.text) {
          try {
            logger.info("[TaskPlannerEnhanced] 尝试2: 修复JSON格式");
            const cleaned = this.cleanAndFixJSON(response.text);
            taskPlan = JSON.parse(cleaned);
            logger.info("[TaskPlannerEnhanced] ✅ JSON修复成功");
          } catch (error2) {
            logger.warn("[TaskPlannerEnhanced] JSON修复失败:", error2.message);

            // 尝试3: 备用LLM（后端AI服务）
            try {
              logger.info("[TaskPlannerEnhanced] 尝试3: 后端AI服务");
              response = await this.queryBackendAI(prompt, {
                systemPrompt:
                  "你是一个专业的项目管理AI助手，擅长将用户需求拆解为清晰、可执行的步骤。你必须返回标准的JSON格式。",
                temperature: 0.3,
              });

              taskPlan = JSON.parse(this.cleanAndFixJSON(response.text));
              logger.info("[TaskPlannerEnhanced] ✅ 后端AI服务成功");
            } catch (error3) {
              logger.warn(
                "[TaskPlannerEnhanced] 后端AI服务失败:",
                error3.message,
              );

              // 尝试4: 基于规则的分解（最后降级）
              try {
                logger.info("[TaskPlannerEnhanced] 尝试4: 基于规则的任务分解");
                taskPlan = this.ruleBasedDecompose(userRequest, projectContext);
                logger.info("[TaskPlannerEnhanced] ✅ 基于规则的分解成功");
              } catch (error4) {
                logger.error(
                  "[TaskPlannerEnhanced] 基于规则的分解也失败:",
                  error4.message,
                );
                // 抛出错误，进入外层catch的createFallbackPlan
                throw new Error("所有降级策略均失败");
              }
            }
          }
        } else {
          // 没有响应文本，直接进入规则分解
          logger.info("[TaskPlannerEnhanced] 无LLM响应，使用规则分解");
          taskPlan = this.ruleBasedDecompose(userRequest, projectContext);
        }
      }

      logger.info(
        "[TaskPlannerEnhanced] 任务计划生成成功，共",
        taskPlan?.subtasks?.length || 0,
        "个子任务",
      );

      // 4. 规范化任务计划
      const normalizedPlan = this.normalizePlan(taskPlan, userRequest);

      // 5. 保存到数据库
      if (projectContext.projectId) {
        await this.saveTaskPlan(projectContext.projectId, normalizedPlan);
      }

      logger.info(
        "[TaskPlannerEnhanced] 任务拆解成功，共",
        normalizedPlan.subtasks.length,
        "个子任务",
      );

      // 6. 缓存任务计划（异步，不等待）
      this.planCache.set(userRequest, normalizedPlan).catch((error) => {
        logger.warn("[TaskPlannerEnhanced] 缓存任务计划失败:", error.message);
      });

      return normalizedPlan;
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] ❌❌❌ 任务拆解失败 ❌❌❌");
      logger.error(
        "[TaskPlannerEnhanced] 错误类型:",
        error?.constructor?.name || "Unknown",
      );
      logger.error(
        "[TaskPlannerEnhanced] 错误信息:",
        error?.message || String(error),
      );
      logger.error(
        "[TaskPlannerEnhanced] 错误堆栈:",
        error?.stack?.substring(0, 500) || "No stack",
      );

      // 降级方案：使用简单的单步任务
      logger.info("[TaskPlannerEnhanced] 使用降级方案创建简单任务计划");
      const fallbackPlan = this.createFallbackPlan(userRequest, projectContext);

      // 🔧 修复：降级方案也需要保存到数据库
      if (projectContext.projectId) {
        try {
          await this.saveTaskPlan(projectContext.projectId, fallbackPlan);
          logger.info("[TaskPlannerEnhanced] 降级任务计划已保存到数据库");
        } catch (saveError) {
          logger.error(
            "[TaskPlannerEnhanced] 降级任务计划保存失败:",
            saveError,
          );
          // 即使保存失败，也返回任务计划（至少可以在内存中使用）
        }
      }

      // 缓存降级计划（异步，不等待）
      this.planCache.set(userRequest, fallbackPlan).catch((error) => {
        logger.warn("[TaskPlannerEnhanced] 缓存降级计划失败:", error.message);
      });

      return fallbackPlan;
    }
  }

  /**
   * 检索RAG上下文
   */
  async retrieveRAGContext(userRequest, projectContext) {
    try {
      const { getProjectRAGManager } = require("../project/project-rag");
      const projectRAG = getProjectRAGManager();

      await projectRAG.initialize();

      const ragResult = await projectRAG.enhancedQuery(
        projectContext.projectId,
        userRequest,
        {
          projectLimit: 3,
          knowledgeLimit: 2,
          conversationLimit: 2,
          useReranker: true,
        },
      );

      logger.info(
        "[TaskPlannerEnhanced] RAG检索完成，找到",
        ragResult.totalDocs,
        "条相关文档",
      );

      return ragResult;
    } catch (error) {
      logger.warn(
        "[TaskPlannerEnhanced] RAG检索失败，继续使用基础上下文:",
        error,
      );
      return null;
    }
  }

  /**
   * 构建任务拆解提示词
   */
  async buildDecomposePrompt(userRequest, projectContext, ragContext = null) {
    const {
      projectType,
      existingFiles = [],
      projectName,
      projectDescription,
      projectPath,
    } = projectContext;

    let prompt = `请将以下用户需求拆解为详细的可执行步骤：

【用户需求】
${userRequest}

【项目信息】`;

    if (projectType) {
      prompt += `\n- 项目类型: ${projectType}`;
    }
    if (projectName) {
      prompt += `\n- 项目名称: ${projectName}`;
    }
    if (projectDescription) {
      prompt += `\n- 项目描述: ${projectDescription}`;
    }
    if (existingFiles.length > 0) {
      prompt += `\n- 现有文件: ${existingFiles.slice(0, 10).join(", ")}${existingFiles.length > 10 ? "..." : ""}`;
    }

    // RAG增强: 添加相关上下文
    if (ragContext && ragContext.context && ragContext.context.length > 0) {
      prompt += `\n\n【相关上下文】(从项目文件、知识库和对话历史中检索)`;

      ragContext.context.slice(0, 5).forEach((doc, index) => {
        const source = doc.source || doc.metadata?.type || "unknown";
        const fileName =
          doc.metadata?.fileName || doc.metadata?.projectName || "未知";
        const excerpt = doc.content.substring(0, 200).replace(/\n/g, " ");

        prompt += `\n\n[${index + 1}] 来源: ${source} | 文件: ${fileName}`;
        prompt += `\n内容摘要: ${excerpt}...`;
      });

      prompt += `\n\n*请参考以上上下文信息，确保任务拆解与现有代码和对话历史一致。*`;
    }

    prompt += `

【输出要求】
请输出标准JSON格式的任务计划，格式如下：

\`\`\`json
{
  "task_title": "任务标题（简洁概括，10字以内）",
  "task_type": "任务类型（create/modify/analyze/export之一）",
  "estimated_duration": "预估时长（如：5分钟、10分钟）",
  "subtasks": [
    {
      "step": 1,
      "title": "子任务标题（简洁，10字以内）",
      "description": "详细描述要做什么（50字以内）",
      "tool": "需要使用的工具",
      "action": "具体操作名称",
      "estimated_tokens": 500,
      "dependencies": [],
      "output_files": ["预期输出的文件名"]
    }
  ],
  "final_output": {
    "type": "最终输出类型（file/report/visualization）",
    "description": "最终交付物描述",
    "files": ["最终文件列表"]
  }
}
\`\`\`

【可用工具说明】
- web-engine: 生成HTML/CSS/JS网页
- document-engine: 生成Markdown/PDF文档、文档转换
- word-engine: 生成Word文档（.docx格式）
- data-engine: 处理Excel/CSV数据、数据分析
- ppt-engine: 生成PowerPoint演示文稿
- code-engine: 生成代码文件
- image-engine: 处理图片

【action操作说明】
- web-engine: generate_html, generate_css, generate_js, create_web_project
- document-engine: create_markdown, export_pdf, export_html
- word-engine: create_document (生成Word文档)
- data-engine: read_excel, analyze_data, calculate_nutrition, create_chart, export_csv
- ppt-engine: generate_presentation
- code-engine: generate_code, create_project_structure

【工具选择建议】
- 如果用户明确要求生成Word文档（含"Word"、"文档"、"报告"、".docx"等关键词），使用 word-engine
- 如果需要Markdown或PDF，使用 document-engine
- 如果需要PPT演示文稿，使用 ppt-engine

【重要规则】
1. 步骤要具体、可执行，避免模糊描述
2. dependencies 是依赖的前置步骤编号（数组，如 [1, 2] 表示依赖步骤1和2）
3. 合理估算 estimated_tokens（简单任务200-500，中等任务500-1000，复杂任务1000-2000）
4. output_files 必须包含具体的文件名
5. 工具和操作必须从上述可用列表中选择
6. 只返回JSON，不要添加其他解释文字`;

    return prompt;
  }

  /**
   * 规范化任务计划
   */
  normalizePlan(taskPlan, userRequest) {
    const timestamp = Date.now();

    const normalized = {
      id: uuidv4(),
      task_title: taskPlan.task_title || userRequest.substring(0, 30),
      task_type: taskPlan.task_type || "create",
      user_request: userRequest,
      estimated_duration: taskPlan.estimated_duration || "未知",
      subtasks: [],
      final_output: taskPlan.final_output || {
        type: "file",
        description: "项目文件",
        files: [],
      },
      status: "pending",
      current_step: 0,
      total_steps: 0,
      progress_percentage: 0,
      started_at: null,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    // 规范化子任务
    if (Array.isArray(taskPlan.subtasks) && taskPlan.subtasks.length > 0) {
      normalized.subtasks = taskPlan.subtasks.map((subtask, index) => ({
        id: uuidv4(),
        step: subtask.step || index + 1,
        title: subtask.title || `步骤 ${index + 1}`,
        description: subtask.description || "",
        tool: subtask.tool || "unknown",
        action: subtask.action || "execute",
        estimated_tokens: subtask.estimated_tokens || 500,
        dependencies: Array.isArray(subtask.dependencies)
          ? subtask.dependencies
          : [],
        output_files: Array.isArray(subtask.output_files)
          ? subtask.output_files
          : [],
        status: "pending", // pending/in_progress/completed/failed
        result: null,
        error: null,
        command: null, // 执行的bash命令（如果有）
        started_at: null,
        completed_at: null,
      }));
      normalized.total_steps = normalized.subtasks.length;
    } else {
      // 如果没有子任务，创建一个默认任务
      normalized.subtasks = [
        {
          id: uuidv4(),
          step: 1,
          title: "执行用户请求",
          description: userRequest,
          tool: "generic",
          action: "execute",
          estimated_tokens: 500,
          dependencies: [],
          output_files: [],
          status: "pending",
          result: null,
          error: null,
          started_at: null,
          completed_at: null,
        },
      ];
      normalized.total_steps = 1;
    }

    return normalized;
  }

  /**
   * 创建降级方案（当LLM失败时）
   */
  /**
   * ⚡ 优化2: JSON清理和修复
   * 尝试修复常见的JSON格式错误
   */
  cleanAndFixJSON(jsonText) {
    let cleaned = jsonText
      // 移除代码块标记
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      // 移除注释
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      // 移除尾随逗号
      .replace(/,(\s*[}\]])/g, "$1")
      // 修复单引号为双引号
      .replace(/'/g, '"')
      // 移除控制字符
      .split("")
      .filter((char) => {
        const code = char.charCodeAt(0);
        return !(code <= 0x1f || (code >= 0x7f && code <= 0x9f));
      })
      .join("")
      .trim();

    // 尝试提取JSON对象
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    return cleaned;
  }

  /**
   * ⚡ 优化2: 基于规则的任务分解
   * 当所有LLM都失败时的最后降级方案
   */
  ruleBasedDecompose(userRequest, projectContext) {
    logger.info("[TaskPlannerEnhanced] 使用基于规则的任务分解");

    // 关键词到工具的映射
    const keywords = {
      react: ["tool_npm_project_setup", "file_writer", "code_generator"],
      vue: ["tool_npm_project_setup", "file_writer", "code_generator"],
      express: ["tool_npm_project_setup", "file_writer", "git_init"],
      python: ["tool_python_project_setup", "file_writer"],
      flask: ["tool_python_project_setup", "file_writer"],
      django: ["tool_python_project_setup", "file_writer"],
      excel: ["tool_excel_generator"],
      word: ["tool_word_generator"],
      ppt: ["tool_ppt_generator"],
      文档: ["tool_word_generator"],
      表格: ["tool_excel_generator"],
      幻灯片: ["tool_ppt_generator"],
      演示: ["tool_ppt_generator"],
    };

    const requestLower = userRequest.toLowerCase();

    // 检测关键词
    const detectedKeywords = Object.keys(keywords).filter((k) =>
      requestLower.includes(k),
    );

    let tools = [];
    if (detectedKeywords.length > 0) {
      // 使用检测到的关键词对应的工具
      tools = detectedKeywords.flatMap((k) => keywords[k]);
      // 去重
      tools = [...new Set(tools)];
    } else {
      // 默认工具链
      tools = ["file_writer", "generic_executor"];
    }

    return {
      id: uuidv4(),
      task_title: userRequest.substring(0, 50),
      task_type: "create",
      user_request: userRequest,
      estimated_duration: "5分钟",
      subtasks: tools.map((tool, i) => ({
        id: uuidv4(),
        step: i + 1,
        title: `执行 ${tool}`,
        tool: tool,
        action: "execute",
        description: userRequest,
        params: { request: userRequest },
        dependencies: i > 0 ? [i] : [],
        output_files: [],
        priority: "normal",
      })),
      final_output: {
        type: "file",
        files: [],
      },
      created_at: new Date().toISOString(),
    };
  }

  createFallbackPlan(userRequest, projectContext) {
    logger.info("[TaskPlannerEnhanced] 使用降级方案");

    const timestamp = Date.now();
    const { projectType = "web", subType, toolEngine } = projectContext;

    // 优先使用意图识别器提供的 toolEngine
    let selectedTool = toolEngine;

    // 如果没有 toolEngine，根据项目类型和子类型推断工具
    if (!selectedTool) {
      // 检查用户需求中的关键词
      const requestLower = userRequest.toLowerCase();
      if (
        requestLower.includes("word") ||
        requestLower.includes("文档") ||
        requestLower.includes("报告") ||
        requestLower.includes("docx") ||
        subType === "word"
      ) {
        selectedTool = "word-engine";
      } else if (
        requestLower.includes("ppt") ||
        requestLower.includes("演示") ||
        requestLower.includes("幻灯片") ||
        subType === "ppt"
      ) {
        selectedTool = "ppt-engine";
      } else {
        // 默认工具映射
        const toolMap = {
          web: "web-engine",
          document: "document-engine",
          data: "data-engine",
          app: "code-engine",
        };
        selectedTool = toolMap[projectType] || "web-engine";
      }
    }

    // 根据工具类型确定输出文件扩展名
    const outputFileMap = {
      "word-engine": ["document.docx"],
      "ppt-engine": ["presentation.pptx"],
      "document-engine": ["document.md"],
      "web-engine": ["output.html"],
      "data-engine": ["data.xlsx"],
      "code-engine": ["code.js"],
    };

    return {
      id: uuidv4(),
      task_title: userRequest.substring(0, 30),
      task_type: "create",
      user_request: userRequest,
      estimated_duration: "5分钟",
      subtasks: [
        {
          id: uuidv4(),
          step: 1,
          title: "执行用户请求",
          description: userRequest,
          tool: selectedTool,
          action: "create_document",
          estimated_tokens: 1000,
          dependencies: [],
          output_files: outputFileMap[selectedTool] || ["output.txt"],
          status: "pending",
          result: null,
          error: null,
          started_at: null,
          completed_at: null,
        },
      ],
      final_output: {
        type: "file",
        description: "生成的文件",
        files: outputFileMap[selectedTool] || ["output.txt"],
      },
      status: "pending",
      current_step: 0,
      total_steps: 1,
      progress_percentage: 0,
      started_at: null,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
  }

  /**
   * 保存任务计划到数据库
   */
  async saveTaskPlan(projectId, taskPlan) {
    try {
      logger.info("[TaskPlannerEnhanced] 准备保存任务计划");
      logger.info("[TaskPlannerEnhanced] projectId:", projectId);
      logger.info("[TaskPlannerEnhanced] taskPlan.id:", taskPlan.id);

      // 🔍 诊断：打印 taskPlan 对象的关键字段
      logger.info("[TaskPlannerEnhanced] 🔍 诊断 taskPlan 对象:");
      logger.info(
        "[TaskPlannerEnhanced] - current_step:",
        taskPlan.current_step,
        "(类型:",
        typeof taskPlan.current_step,
        ")",
      );
      logger.info(
        "[TaskPlannerEnhanced] - total_steps:",
        taskPlan.total_steps,
        "(类型:",
        typeof taskPlan.total_steps,
        ")",
      );
      logger.info(
        "[TaskPlannerEnhanced] - progress_percentage:",
        taskPlan.progress_percentage,
        "(类型:",
        typeof taskPlan.progress_percentage,
        ")",
      );
      logger.info(
        "[TaskPlannerEnhanced] - final_output:",
        JSON.stringify(taskPlan.final_output || {}).substring(0, 100),
      );

      // 验证projectId
      if (!projectId) {
        logger.warn(
          "[TaskPlannerEnhanced] 警告: projectId为空，跳过保存任务计划",
        );
        return;
      }

      // 验证project是否存在
      const projectExists = this.database.get(
        "SELECT id FROM projects WHERE id = ?",
        [projectId],
      );
      logger.info("[TaskPlannerEnhanced] 项目存在?", !!projectExists);

      if (!projectExists) {
        logger.warn(
          "[TaskPlannerEnhanced] 警告: 项目不存在 (projectId:",
          projectId,
          ")，跳过保存任务计划",
        );
        return;
      }

      // 将 sql 定义在 try 外部，以便 catch 块可以访问
      const sql = `
        INSERT INTO project_task_plans (
          id, project_id, task_title, task_type, user_request,
          estimated_duration, subtasks, final_output, status,
          current_step, total_steps, progress_percentage,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      // 🔍 诊断：在构建 params 前再次检查这三个字段
      logger.info("[TaskPlannerEnhanced] ⚠️ 构建params前最后检查:");
      logger.info(
        "[TaskPlannerEnhanced] - taskPlan.current_step:",
        taskPlan.current_step,
      );
      logger.info(
        "[TaskPlannerEnhanced] - taskPlan.total_steps:",
        taskPlan.total_steps,
      );
      logger.info(
        "[TaskPlannerEnhanced] - taskPlan.progress_percentage:",
        taskPlan.progress_percentage,
      );

      // 确保数字字段类型正确
      const ensureNumber = (value, defaultValue = 0) => {
        const num = Number(value);
        return !isNaN(num) && isFinite(num) ? num : defaultValue;
      };

      const params = [
        taskPlan.id || null,
        projectId || null,
        taskPlan.task_title || null,
        taskPlan.task_type || null,
        taskPlan.user_request || null,
        taskPlan.estimated_duration || null,
        JSON.stringify(taskPlan.subtasks || []),
        JSON.stringify(taskPlan.final_output || {}),
        taskPlan.status || "pending",
        ensureNumber(taskPlan.current_step, 0),
        ensureNumber(taskPlan.total_steps, 0),
        ensureNumber(taskPlan.progress_percentage, 0),
        taskPlan.created_at || Date.now(),
        taskPlan.updated_at || Date.now(),
      ];

      logger.info("[TaskPlannerEnhanced] ========== SQL参数摘要 ==========");
      logger.info("[TaskPlannerEnhanced] 参数数量:", params.length);
      logger.info("[TaskPlannerEnhanced] id:", params[0]);
      logger.info("[TaskPlannerEnhanced] project_id:", params[1]);
      logger.info("[TaskPlannerEnhanced] task_title:", params[2]);
      logger.info("[TaskPlannerEnhanced] status:", params[8]);
      logger.info(
        "[TaskPlannerEnhanced] current_step:",
        params[9],
        "total_steps:",
        params[10],
        "progress:",
        params[11],
      );
      logger.info("[TaskPlannerEnhanced] ============ 摘要结束 ============");

      // 检查是否有undefined、NaN或Infinity值
      const invalidIndices = [];
      const notNullFields = [0, 1]; // id和project_id不能为null
      const paramNames = [
        "id",
        "project_id",
        "task_title",
        "task_type",
        "user_request",
        "estimated_duration",
        "subtasks",
        "final_output",
        "status",
        "current_step",
        "total_steps",
        "progress_percentage",
        "created_at",
        "updated_at",
      ];

      params.forEach((p, i) => {
        if (p === undefined) {
          invalidIndices.push(`params[${i}](${paramNames[i]}) 是 undefined`);
        }
        if (notNullFields.includes(i) && (p === null || p === undefined)) {
          invalidIndices.push(
            `params[${i}](${paramNames[i]}) 不能为NULL，但当前为${p}`,
          );
        }
        if (typeof p === "number" && !isFinite(p)) {
          invalidIndices.push(
            `params[${i}](${paramNames[i]}) 是特殊数值 (NaN/Infinity)`,
          );
        }
      });

      if (invalidIndices.length > 0) {
        const errorMsg = `参数验证失败:\n${invalidIndices.join("\n")}`;
        logger.error("[TaskPlannerEnhanced]", errorMsg);
        throw new Error(errorMsg);
      }

      if (params.length !== 14) {
        throw new Error(`参数数组长度错误：期望14个，实际${params.length}个`);
      }

      logger.info("[TaskPlannerEnhanced] 参数验证通过，准备执行SQL插入");
      logger.info("[TaskPlannerEnhanced] 🔹 调用 database.run() 开始...");

      this.database.run(sql, params);

      logger.info("[TaskPlannerEnhanced] 🔹 database.run() 调用完成");
      logger.info(
        "[TaskPlannerEnhanced] ✅ 任务计划已保存到数据库:",
        taskPlan.id,
      );

      // 验证保存成功
      logger.info("[TaskPlannerEnhanced] 开始验证保存结果...");
      const saved = this.database.get(
        "SELECT id FROM project_task_plans WHERE id = ?",
        [taskPlan.id],
      );
      logger.info(
        "[TaskPlannerEnhanced] 保存验证结果:",
        saved ? "✅ 成功找到记录" : "❌ 未找到记录",
      );

      if (!saved) {
        logger.error(
          "[TaskPlannerEnhanced] ❌ 警告: 数据库插入后查询不到记录，可能保存失败！",
        );
        throw new Error("任务计划保存失败：插入后无法查询到记录");
      }
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] ❌❌❌ 保存任务计划失败 ❌❌❌");
      logger.error(
        "[TaskPlannerEnhanced] Error类型:",
        error?.constructor?.name || "Unknown",
      );
      logger.error(
        "[TaskPlannerEnhanced] Error信息:",
        error?.message || String(error),
      );
      logger.error(
        "[TaskPlannerEnhanced] Error stack前500字:",
        error?.stack?.substring(0, 500) || "No stack",
      );
      logger.error("[TaskPlannerEnhanced] projectId:", projectId);
      logger.error("[TaskPlannerEnhanced] taskPlan.id:", taskPlan.id);
      // 重新抛出错误，让上层处理
      throw error;
    }
  }

  /**
   * 更新任务计划状态
   */
  async updateTaskPlan(taskPlanId, updates) {
    try {
      const fields = [];
      const params = [];

      Object.keys(updates).forEach((key) => {
        if (key === "subtasks" || key === "final_output") {
          fields.push(`${key} = ?`);
          params.push(JSON.stringify(updates[key]));
        } else {
          fields.push(`${key} = ?`);
          params.push(updates[key]);
        }
      });

      fields.push("updated_at = ?");
      params.push(Date.now());
      params.push(taskPlanId);

      const sql = `UPDATE project_task_plans SET ${fields.join(", ")} WHERE id = ?`;
      this.database.run(sql, params);
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] 更新任务计划失败:", error);
    }
  }

  /**
   * 执行任务计划
   * @param {Object} taskPlan - 任务计划
   * @param {Object} projectContext - 项目上下文
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} 执行结果
   */
  async executeTaskPlan(taskPlan, projectContext, progressCallback) {
    logger.info("[TaskPlannerEnhanced] 开始执行任务计划:", taskPlan.task_title);

    try {
      const results = [];

      // 更新任务状态为执行中
      taskPlan.status = "in_progress";
      taskPlan.started_at = Date.now();
      await this.updateTaskPlan(taskPlan.id, {
        status: "in_progress",
        started_at: taskPlan.started_at,
      });

      this.emit("task-started", taskPlan);
      if (progressCallback) {
        progressCallback({
          type: "task-started",
          taskPlan: taskPlan,
        });
      }

      // 质量门禁检查
      const gateResults = await this.qualityGateChecker.runAllGates(taskPlan);

      if (!gateResults.passed) {
        // 质量门禁未通过，终止执行
        const errorMessage = `质量门禁检查失败: ${gateResults.errors.join("; ")}`;
        logger.error("[TaskPlannerEnhanced]", errorMessage);

        taskPlan.status = "failed";
        taskPlan.error_message = errorMessage;
        taskPlan.completed_at = Date.now();

        await this.updateTaskPlan(taskPlan.id, {
          status: "failed",
          error_message: errorMessage,
          completed_at: taskPlan.completed_at,
        });

        this.emit("task-failed", {
          taskPlan,
          error: errorMessage,
          gateResults,
        });
        if (progressCallback) {
          progressCallback({
            type: "task-failed",
            taskPlan: taskPlan,
            error: errorMessage,
            gateResults,
          });
        }

        throw new Error(errorMessage);
      }

      // 质量门禁通过，记录警告（如果有）
      if (gateResults.warnings && gateResults.warnings.length > 0) {
        logger.warn(
          "[TaskPlannerEnhanced] 质量门禁警告:",
          gateResults.warnings,
        );
        this.emit("quality-gate-warnings", {
          taskPlan,
          warnings: gateResults.warnings,
        });
        if (progressCallback) {
          progressCallback({
            type: "quality-gate-warnings",
            warnings: gateResults.warnings,
          });
        }
      }

      logger.info(
        `[TaskPlannerEnhanced] ✅ 质量门禁检查通过 (${gateResults.duration}ms)`,
      );

      // 解析执行顺序（基于依赖关系）
      const executionOrder = this.resolveExecutionOrder(taskPlan.subtasks);
      logger.info("[TaskPlannerEnhanced] 执行顺序:", executionOrder);

      // 按顺序执行子任务
      for (const step of executionOrder) {
        const subtask = taskPlan.subtasks.find((t) => t.step === step);
        if (!subtask) {
          continue;
        }

        // 更新当前步骤
        taskPlan.current_step = step;
        taskPlan.progress_percentage = Math.round(
          (step / taskPlan.total_steps) * 100,
        );

        // 更新子任务状态为执行中
        subtask.status = "in_progress";
        subtask.started_at = Date.now();

        await this.updateTaskPlan(taskPlan.id, {
          current_step: taskPlan.current_step,
          progress_percentage: taskPlan.progress_percentage,
          subtasks: taskPlan.subtasks,
        });

        this.emit("subtask-started", { taskPlan, subtask });
        if (progressCallback) {
          progressCallback({
            type: "subtask-started",
            taskPlan: taskPlan,
            subtask: subtask,
            step: subtask.step,
            total: taskPlan.total_steps,
          });
        }

        try {
          // 执行子任务
          const result = await this.executeSubtask(
            subtask,
            projectContext,
            progressCallback,
          );

          // 更新子任务状态为完成
          subtask.status = "completed";
          subtask.result = result;
          subtask.completed_at = Date.now();

          results.push(result);

          await this.updateTaskPlan(taskPlan.id, {
            subtasks: taskPlan.subtasks,
          });

          this.emit("subtask-completed", { taskPlan, subtask, result });
          if (progressCallback) {
            progressCallback({
              type: "subtask-completed",
              taskPlan: taskPlan,
              subtask: subtask,
              result: result,
            });
          }
        } catch (error) {
          logger.error(
            `[TaskPlannerEnhanced] 子任务 ${subtask.step} 执行失败:`,
            error,
          );

          // 更新子任务状态为失败
          subtask.status = "failed";
          subtask.error = error.message;
          subtask.completed_at = Date.now();

          await this.updateTaskPlan(taskPlan.id, {
            subtasks: taskPlan.subtasks,
          });

          this.emit("subtask-failed", { taskPlan, subtask, error });
          if (progressCallback) {
            progressCallback({
              type: "subtask-failed",
              taskPlan: taskPlan,
              subtask: subtask,
              error: error.message,
            });
          }

          // 停止执行后续任务
          throw error;
        }
      }

      // 所有任务完成
      taskPlan.status = "completed";
      taskPlan.completed_at = Date.now();
      taskPlan.progress_percentage = 100;

      await this.updateTaskPlan(taskPlan.id, {
        status: "completed",
        completed_at: taskPlan.completed_at,
        progress_percentage: 100,
      });

      this.emit("task-completed", { taskPlan, results });
      if (progressCallback) {
        progressCallback({
          type: "task-completed",
          taskPlan: taskPlan,
          results: results,
        });
      }

      logger.info("[TaskPlannerEnhanced] 任务计划执行完成");

      return {
        success: true,
        taskPlan: taskPlan,
        results: results,
      };
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] 任务计划执行失败:", error);

      taskPlan.status = "failed";
      taskPlan.error_message = error.message;
      taskPlan.completed_at = Date.now();

      await this.updateTaskPlan(taskPlan.id, {
        status: "failed",
        error_message: error.message,
        completed_at: taskPlan.completed_at,
      });

      this.emit("task-failed", { taskPlan, error });
      if (progressCallback) {
        progressCallback({
          type: "task-failed",
          taskPlan: taskPlan,
          error: error.message,
        });
      }

      return {
        success: false,
        taskPlan: taskPlan,
        error: error.message,
      };
    }
  }

  /**
   * 解析执行顺序（基于依赖关系）
   * 使用拓扑排序算法
   */
  resolveExecutionOrder(subtasks) {
    const order = [];
    const completed = new Set();
    const remaining = new Set(subtasks.map((t) => t.step));

    const maxIterations = subtasks.length * 2; // 防止无限循环
    let iterations = 0;

    while (remaining.size > 0 && iterations < maxIterations) {
      iterations++;
      let addedInThisRound = false;

      for (const step of remaining) {
        const subtask = subtasks.find((t) => t.step === step);
        if (!subtask) {
          continue;
        }

        // 检查依赖是否都已完成
        const dependenciesMet = subtask.dependencies.every((dep) =>
          completed.has(dep),
        );

        if (dependenciesMet) {
          order.push(step);
          completed.add(step);
          remaining.delete(step);
          addedInThisRound = true;
        }
      }

      // 如果这一轮没有添加任何任务，说明存在循环依赖
      if (!addedInThisRound) {
        logger.warn(
          "[TaskPlannerEnhanced] 检测到循环依赖或无效依赖，强制添加剩余任务",
        );
        // 强制添加剩余任务（忽略依赖）
        for (const step of remaining) {
          order.push(step);
        }
        break;
      }
    }

    return order;
  }

  /**
   * 执行单个子任务
   */
  async executeSubtask(subtask, projectContext, progressCallback) {
    logger.info(
      `[TaskPlannerEnhanced] 执行子任务 ${subtask.step}: ${subtask.title}`,
    );

    const { tool, action, description } = subtask;

    try {
      // 根据工具类型调用相应的引擎
      switch (tool) {
        case "web-engine":
          return await this.executeWebEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "document-engine":
          return await this.executeDocumentEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "word-engine":
          return await this.executeWordEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "data-engine":
          return await this.executeDataEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "ppt-engine":
          return await this.executePPTEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "code-engine":
          return await this.executeCodeEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "image-engine":
          return await this.executeImageEngineTask(
            subtask,
            projectContext,
            progressCallback,
          );

        case "generic":
        case "unknown":
        default:
          // 通用处理：使用LLM生成内容
          return await this.executeGenericTask(
            subtask,
            projectContext,
            progressCallback,
          );
      }
    } catch (error) {
      logger.error(`[TaskPlannerEnhanced] 子任务执行失败:`, error);
      throw error;
    }
  }

  /**
   * 执行Web引擎任务
   */
  async executeWebEngineTask(subtask, projectContext, progressCallback) {
    const webEngine = this.loadEngine("web-engine");
    const { action, description, output_files } = subtask;

    logger.info(`[TaskPlannerEnhanced] Web引擎 - ${action}`);

    // 根据action执行不同操作
    const result = await webEngine.handleProjectTask({
      action: action,
      description: description,
      outputFiles: output_files,
      projectPath: projectContext.root_path,
      llmManager: this.llmManager,
    });

    return result;
  }

  /**
   * 执行文档引擎任务
   */
  async executeDocumentEngineTask(subtask, projectContext, progressCallback) {
    const documentEngine = this.loadEngine("document-engine");
    const { action, description, output_files } = subtask;

    logger.info(`[TaskPlannerEnhanced] 文档引擎 - ${action}`);

    const result = await documentEngine.handleProjectTask({
      action: action,
      description: description,
      outputFiles: output_files,
      projectPath: projectContext.root_path,
      llmManager: this.llmManager,
    });

    return result;
  }

  /**
   * 执行数据引擎任务
   */
  async executeDataEngineTask(subtask, projectContext, progressCallback) {
    const dataEngine = this.loadEngine("data-engine");
    const { action, description, output_files } = subtask;

    logger.info(`[TaskPlannerEnhanced] 数据引擎 - ${action}`);

    const result = await dataEngine.handleProjectTask({
      action: action,
      description: description,
      outputFiles: output_files,
      projectPath: projectContext.root_path,
      llmManager: this.llmManager,
    });

    return result;
  }

  /**
   * 执行PPT引擎任务
   */
  async executePPTEngineTask(subtask, projectContext, progressCallback) {
    try {
      const pptEngine = this.loadEngine("ppt-engine");
      const { action, description, output_files } = subtask;

      logger.info(`[TaskPlannerEnhanced] PPT引擎 - ${action}`);

      const result = await pptEngine.handleProjectTask({
        action: action,
        description: description,
        outputFiles: output_files,
        projectPath: projectContext.root_path,
        llmManager: this.llmManager,
      });

      return result;
    } catch (error) {
      if (error.message.includes("不存在或加载失败")) {
        logger.warn("[TaskPlannerEnhanced] PPT引擎未实现，使用LLM生成大纲");
        return await this.executeGenericTask(
          subtask,
          projectContext,
          progressCallback,
        );
      }
      throw error;
    }
  }

  /**
   * 执行Word引擎任务
   */
  async executeWordEngineTask(subtask, projectContext, progressCallback) {
    try {
      const wordEngine = this.loadEngine("word-engine");
      const { action, description, output_files } = subtask;

      logger.info(`[TaskPlannerEnhanced] Word引擎 - ${action}`);

      const result = await wordEngine.handleProjectTask({
        action: action,
        description: description,
        outputFiles: output_files,
        projectPath: projectContext.root_path,
        llmManager: this.llmManager,
      });

      return result;
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] Word引擎执行失败:", error);
      throw error;
    }
  }

  /**
   * 执行代码引擎任务
   */
  async executeCodeEngineTask(subtask, projectContext, progressCallback) {
    logger.info(`[TaskPlannerEnhanced] 代码引擎 - ${subtask.action}`);

    // 使用LLM生成代码
    const response = await this.llmManager.query(
      `请生成以下代码：\n\n${subtask.description}\n\n要求：直接输出代码，不要解释。`,
      {
        temperature: 0.2,
        maxTokens: subtask.estimated_tokens || 1000,
      },
    );

    return {
      type: "code",
      content: response.text,
      files: subtask.output_files,
    };
  }

  /**
   * 执行图像引擎任务
   */
  async executeImageEngineTask(subtask, projectContext, progressCallback) {
    logger.info(`[TaskPlannerEnhanced] 图像引擎 - ${subtask.action}`);

    // 图像引擎通常需要调用外部API（Stable Diffusion等）
    // 这里返回一个占位结果
    return {
      type: "image",
      message: "图像引擎功能开发中",
      description: subtask.description,
    };
  }

  /**
   * 执行通用任务（使用LLM）
   */
  async executeGenericTask(subtask, projectContext, progressCallback) {
    logger.info(`[TaskPlannerEnhanced] 通用任务执行: ${subtask.title}`);

    const response = await this.llmManager.query(subtask.description, {
      temperature: 0.7,
      maxTokens: subtask.estimated_tokens || 1000,
    });

    return {
      type: "text",
      content: response.text,
      tokens: response.tokens,
    };
  }

  /**
   * 获取项目的任务计划历史
   */
  async getTaskPlanHistory(projectId, limit = 10) {
    try {
      const sql = `
        SELECT * FROM project_task_plans
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const plans = this.database.all(sql, [projectId, limit]);

      return plans.map((plan) => ({
        ...plan,
        subtasks: JSON.parse(plan.subtasks),
        final_output: JSON.parse(plan.final_output || "null"),
      }));
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] 获取任务计划历史失败:", error);
      return [];
    }
  }

  /**
   * 获取单个任务计划
   */
  async getTaskPlan(taskPlanId) {
    try {
      logger.info("[TaskPlannerEnhanced] 查询任务计划:", taskPlanId);
      const sql = `SELECT * FROM project_task_plans WHERE id = ?`;
      const plan = this.database.get(sql, [taskPlanId]);

      logger.info("[TaskPlannerEnhanced] 查询结果:", plan ? "找到" : "未找到");

      if (plan) {
        plan.subtasks = JSON.parse(plan.subtasks);
        plan.final_output = JSON.parse(plan.final_output || "null");
      }

      return plan;
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] 获取任务计划失败:", error);
      logger.error("[TaskPlannerEnhanced] Error stack:", error.stack);
      return null;
    }
  }

  /**
   * 查询后端AI服务（降级方案）
   */
  async queryBackendAI(prompt, options = {}) {
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");

    const backendURL = process.env.AI_SERVICE_URL || "http://localhost:8001";
    logger.info("[TaskPlannerEnhanced] 调用后端AI服务:", backendURL);

    return new Promise((resolve, reject) => {
      const url = new URL("/api/chat/stream", backendURL);
      const isHttps = url.protocol === "https:";
      const httpModule = isHttps ? https : http;

      const messages = [
        {
          role: "system",
          content: options.systemPrompt || "You are a helpful assistant.",
        },
        { role: "user", content: prompt },
      ];

      const postData = JSON.stringify({
        messages,
        temperature: options.temperature || 0.7,
      });

      const requestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 600000, // 10 分钟
      };

      const req = httpModule.request(requestOptions, (res) => {
        let fullText = "";
        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString("utf8");

          // 按行处理SSE
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // 保留最后一个不完整的行

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const jsonStr = line.slice(6).trim();
                if (jsonStr) {
                  const data = JSON.parse(jsonStr);

                  if (data.type === "content" && data.content) {
                    fullText += data.content;
                  } else if (data.type === "error") {
                    reject(new Error(data.error));
                    return;
                  } else if (data.type === "done") {
                    logger.info(
                      "[TaskPlannerEnhanced] 后端AI响应长度:",
                      fullText.length,
                    );
                    resolve({
                      text: fullText,
                      tokens: Math.ceil(fullText.length / 4),
                    });
                    return;
                  }
                }
              } catch (parseError) {
                // 忽略解析错误，继续处理
              }
            }
          }
        });

        res.on("end", () => {
          // 如果没有收到done事件，直接返回累积的文本
          if (fullText) {
            logger.info(
              "[TaskPlannerEnhanced] 后端AI响应完成，长度:",
              fullText.length,
            );
            resolve({
              text: fullText,
              tokens: Math.ceil(fullText.length / 4),
            });
          } else {
            reject(new Error("后端AI服务未返回任何内容"));
          }
        });

        res.on("error", (err) => {
          logger.error("[TaskPlannerEnhanced] 响应错误:", err);
          reject(err);
        });
      });

      req.on("error", (err) => {
        logger.error("[TaskPlannerEnhanced] 请求错误:", err);
        reject(err);
      });

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("后端AI服务请求超时"));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * 取消任务计划
   */
  async cancelTaskPlan(taskPlanId) {
    try {
      await this.updateTaskPlan(taskPlanId, {
        status: "cancelled",
        completed_at: Date.now(),
      });

      this.emit("task-cancelled", { taskPlanId });

      logger.info("[TaskPlannerEnhanced] 任务计划已取消:", taskPlanId);
    } catch (error) {
      logger.error("[TaskPlannerEnhanced] 取消任务计划失败:", error);
      throw error;
    }
  }
}

module.exports = TaskPlannerEnhanced;
