/**
 * 交互式任务规划器（Claude Plan模式）
 *
 * 核心功能：
 * 1. 生成任务计划后先让用户确认
 * 2. 集成模板库，推荐相关模板
 * 3. 集成技能系统，推荐可用工具
 * 4. 支持用户调整参数和需求
 * 5. 质量评估和迭代优化
 */

const { logger, createLogger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class InteractiveTaskPlanner extends EventEmitter {
  constructor(dependencies) {
    super();

    // 依赖注入
    this.llmManager = dependencies.llmManager;
    this.database = dependencies.database;
    this.projectConfig = dependencies.projectConfig;
    this.templateManager = dependencies.templateManager;
    this.skillRecommender = dependencies.skillRecommender;

    // 基础任务规划器（用于实际执行）
    this.baseTaskPlanner = dependencies.baseTaskPlanner;

    // Plan会话状态管理
    this.planSessions = new Map(); // sessionId -> PlanSession
  }

  /**
   * 开始Plan模式对话
   * @param {string} userRequest - 用户需求
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} Plan会话信息
   */
  async startPlanSession(userRequest, projectContext = {}) {
    logger.info('[InteractiveTaskPlanner] 开始Plan模式对话:', userRequest);

    const sessionId = uuidv4();
    const session = {
      id: sessionId,
      userRequest,
      projectContext,
      status: 'planning', // planning -> awaiting_confirmation -> executing -> completed
      createdAt: Date.now(),

      // Plan相关数据
      taskPlan: null,
      recommendedTemplates: [],
      recommendedSkills: [],
      recommendedTools: [],

      // 用户交互
      userConfirmation: null,
      userAdjustments: [],

      // 执行结果
      executionResult: null,
      qualityScore: null,
      userFeedback: null
    };

    this.planSessions.set(sessionId, session);

    try {
      // Step 1: 生成初始任务计划
      const taskPlan = await this.generateTaskPlan(userRequest, projectContext);
      session.taskPlan = taskPlan;

      // Step 2: 推荐相关模板
      const templates = await this.recommendTemplates(userRequest, projectContext, taskPlan);
      session.recommendedTemplates = templates;

      // Step 3: 推荐技能和工具
      const skills = await this.recommendSkills(userRequest, projectContext, taskPlan);
      session.recommendedSkills = skills;

      const tools = await this.recommendTools(userRequest, projectContext, taskPlan);
      session.recommendedTools = tools;

      // Step 4: 状态更新为等待确认
      session.status = 'awaiting_confirmation';

      // Step 5: 返回Plan供用户确认
      const planPresentation = this.formatPlanForUser(session);

      this.emit('plan-generated', { sessionId, planPresentation });

      return {
        sessionId,
        status: 'awaiting_confirmation',
        plan: planPresentation,
        message: '已生成任务计划，请确认或调整'
      };

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] Plan生成失败:', error);
      session.status = 'failed';
      session.error = error.message;

      return {
        sessionId,
        status: 'failed',
        error: error.message,
        message: '任务计划生成失败，请重试'
      };
    }
  }

  /**
   * 生成任务计划
   */
  async generateTaskPlan(userRequest, projectContext) {
    // 使用基础任务规划器生成计划
    const taskPlan = await this.baseTaskPlanner.decomposeTask(userRequest, projectContext);
    return taskPlan;
  }

  /**
   * 推荐相关模板
   */
  async recommendTemplates(userRequest, projectContext, taskPlan) {
    try {
      if (!this.templateManager) {
        logger.warn('[InteractiveTaskPlanner] 模板管理器未初始化');
        return [];
      }

      // 根据项目类型和子类型搜索模板
      const { projectType, subType } = projectContext;

      const templates = await this.templateManager.searchTemplates({
        category: projectType,
        tags: [subType, taskPlan.task_type],
        limit: 5
      });

      // 为每个模板计算相关度分数
      return templates.map(template => ({
        ...template,
        relevanceScore: this.calculateTemplateRelevance(template, userRequest, taskPlan),
        reason: `推荐理由：此模板适用于${template.category}类项目`
      })).sort((a, b) => b.relevanceScore - a.relevanceScore);

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 模板推荐失败:', error);
      return [];
    }
  }

  /**
   * 推荐技能
   */
  async recommendSkills(userRequest, projectContext, taskPlan) {
    try {
      if (!this.skillRecommender) {
        logger.warn('[InteractiveTaskPlanner] 技能推荐器未初始化');
        return [];
      }

      const skills = await this.skillRecommender.recommendSkills(userRequest, {
        limit: 10,
        threshold: 0.3,
        includeUsageStats: true
      });

      return skills;

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 技能推荐失败:', error);
      return [];
    }
  }

  /**
   * 推荐工具
   */
  async recommendTools(userRequest, projectContext, taskPlan) {
    try {
      const tools = [];

      // 从任务计划中提取需要的工具
      if (taskPlan.subtasks) {
        const toolSet = new Set();

        taskPlan.subtasks.forEach(subtask => {
          if (subtask.tool) {
            toolSet.add(subtask.tool);
          }
        });

        // 为每个工具添加描述
        const toolDescriptions = {
          'web-engine': { name: 'Web引擎', description: '生成HTML/CSS/JS网页', capability: '前端开发' },
          'document-engine': { name: '文档引擎', description: '生成Word/PDF/Markdown文档', capability: '文档撰写' },
          'word-engine': { name: 'Word引擎', description: '生成Word文档', capability: 'Word文档生成' },
          'excel-engine': { name: 'Excel引擎', description: '生成Excel表格', capability: 'Excel表格处理' },
          'ppt-engine': { name: 'PPT引擎', description: '生成PowerPoint演示文稿', capability: 'PPT制作' },
          'pdf-engine': { name: 'PDF引擎', description: '生成PDF文档', capability: 'PDF生成' },
          'data-engine': { name: '数据引擎', description: '数据分析和可视化', capability: '数据处理' },
          'code-engine': { name: '代码引擎', description: '生成代码文件', capability: '代码生成' },
          'image-engine': { name: '图片引擎', description: '图片处理和生成', capability: '图像处理' },
          'video-engine': { name: '视频引擎', description: '视频制作和编辑', capability: '视频处理' }
        };

        toolSet.forEach(toolName => {
          const info = toolDescriptions[toolName] || {
            name: toolName,
            description: '未知工具',
            capability: '通用处理'
          };

          tools.push({
            tool: toolName,
            ...info,
            recommendationReason: `此任务需要使用${info.name}完成${info.capability}功能`
          });
        });
      }

      return tools;

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 工具推荐失败:', error);
      return [];
    }
  }

  /**
   * 计算模板相关度
   */
  calculateTemplateRelevance(template, userRequest, taskPlan) {
    let score = 0.5; // 基础分

    // 1. 检查标题匹配
    if (template.title && userRequest.includes(template.title)) {
      score += 0.2;
    }

    // 2. 检查标签匹配
    if (template.tags && Array.isArray(template.tags)) {
      const matchedTags = template.tags.filter(tag =>
        userRequest.toLowerCase().includes(tag.toLowerCase())
      );
      score += matchedTags.length * 0.1;
    }

    // 3. 检查类别匹配
    if (template.category && taskPlan.task_type === template.category) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  /**
   * 格式化Plan供用户查看
   */
  formatPlanForUser(session) {
    const { taskPlan, recommendedTemplates, recommendedSkills, recommendedTools } = session;

    return {
      // 任务概述
      overview: {
        title: taskPlan.task_title,
        type: taskPlan.task_type,
        estimatedDuration: taskPlan.estimated_duration,
        totalSteps: taskPlan.total_steps,
        description: taskPlan.user_request
      },

      // 执行步骤
      steps: taskPlan.subtasks.map(subtask => ({
        step: subtask.step,
        title: subtask.title,
        description: subtask.description,
        tool: subtask.tool,
        action: subtask.action,
        estimatedTokens: subtask.estimated_tokens,
        dependencies: subtask.dependencies,
        outputFiles: subtask.output_files
      })),

      // 最终输出
      finalOutput: taskPlan.final_output,

      // 推荐资源
      recommendations: {
        templates: recommendedTemplates.slice(0, 3).map(t => ({
          id: t.id,
          title: t.title,
          category: t.category,
          description: t.description,
          relevanceScore: t.relevanceScore,
          reason: t.reason
        })),

        skills: recommendedSkills.slice(0, 5).map(s => ({
          id: s.id,
          name: s.name,
          category: s.category,
          description: s.description,
          recommendationScore: s.recommendationScore,
          reason: s.reason
        })),

        tools: recommendedTools.map(t => ({
          tool: t.tool,
          name: t.name,
          description: t.description,
          capability: t.capability,
          reason: t.recommendationReason
        }))
      },

      // 可调整参数
      adjustableParameters: this.extractAdjustableParameters(taskPlan)
    };
  }

  /**
   * 提取可调整参数
   */
  extractAdjustableParameters(taskPlan) {
    const parameters = [];

    // 1. 文档标题
    if (taskPlan.task_title) {
      parameters.push({
        key: 'title',
        label: '文档标题',
        currentValue: taskPlan.task_title,
        type: 'string',
        editable: true
      });
    }

    // 2. 输出格式
    if (taskPlan.final_output && taskPlan.final_output.type) {
      parameters.push({
        key: 'outputFormat',
        label: '输出格式',
        currentValue: taskPlan.final_output.type,
        type: 'select',
        options: ['file', 'report', 'visualization', 'presentation'],
        editable: true
      });
    }

    // 3. 详细程度
    parameters.push({
      key: 'detailLevel',
      label: '详细程度',
      currentValue: 'standard',
      type: 'select',
      options: ['brief', 'standard', 'detailed', 'comprehensive'],
      editable: true
    });

    // 4. 是否包含示例
    parameters.push({
      key: 'includeExamples',
      label: '包含示例',
      currentValue: true,
      type: 'boolean',
      editable: true
    });

    return parameters;
  }

  /**
   * 用户确认或调整Plan
   * @param {string} sessionId - 会话ID
   * @param {Object} userResponse - 用户响应
   * @returns {Promise<Object>} 处理结果
   */
  async handleUserResponse(sessionId, userResponse) {
    const session = this.planSessions.get(sessionId);

    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    if (session.status !== 'awaiting_confirmation') {
      throw new Error(`会话状态错误: ${session.status}，期望: awaiting_confirmation`);
    }

    const { action, adjustments, selectedTemplate, feedback } = userResponse;

    try {
      switch (action) {
        case 'confirm':
          // 用户确认，开始执行
          return await this.executeConfirmedPlan(sessionId);

        case 'adjust':
          // 用户调整参数
          return await this.adjustPlan(sessionId, adjustments);

        case 'use_template':
          // 用户选择使用推荐的模板
          return await this.applyTemplate(sessionId, selectedTemplate);

        case 'cancel':
          // 用户取消
          session.status = 'cancelled';
          session.cancelledAt = Date.now();
          return {
            sessionId,
            status: 'cancelled',
            message: '任务已取消'
          };

        case 'regenerate':
          // 用户要求重新生成Plan
          return await this.regeneratePlan(sessionId, feedback);

        default:
          throw new Error(`未知的操作: ${action}`);
      }

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 处理用户响应失败:', error);
      return {
        sessionId,
        status: 'error',
        error: error.message,
        message: '处理失败，请重试'
      };
    }
  }

  /**
   * 执行已确认的Plan
   */
  async executeConfirmedPlan(sessionId) {
    const session = this.planSessions.get(sessionId);

    session.status = 'executing';
    session.executionStartedAt = Date.now();

    this.emit('execution-started', { sessionId });

    try {
      // 使用基础任务规划器执行
      const result = await this.baseTaskPlanner.executeTaskPlan(
        session.taskPlan,
        session.projectContext,
        (progress) => {
          // 转发进度事件
          this.emit('execution-progress', { sessionId, progress });
        }
      );

      session.executionResult = result;
      session.status = 'completed';
      session.completedAt = Date.now();

      // 执行质量评估
      const qualityScore = await this.evaluateQuality(session);
      session.qualityScore = qualityScore;

      this.emit('execution-completed', { sessionId, result, qualityScore });

      return {
        sessionId,
        status: 'completed',
        result,
        qualityScore,
        message: '任务执行完成'
      };

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 执行失败:', error);

      session.status = 'failed';
      session.error = error.message;
      session.failedAt = Date.now();

      this.emit('execution-failed', { sessionId, error });

      return {
        sessionId,
        status: 'failed',
        error: error.message,
        message: '任务执行失败'
      };
    }
  }

  /**
   * 调整Plan参数
   */
  async adjustPlan(sessionId, adjustments) {
    const session = this.planSessions.get(sessionId);

    logger.info('[InteractiveTaskPlanner] 调整Plan:', adjustments);

    // 记录用户调整
    session.userAdjustments.push({
      timestamp: Date.now(),
      adjustments
    });

    // 应用调整到taskPlan
    if (adjustments.title) {
      session.taskPlan.task_title = adjustments.title;
    }

    if (adjustments.detailLevel) {
      // 根据详细程度调整estimated_tokens
      const tokenMultipliers = {
        'brief': 0.5,
        'standard': 1.0,
        'detailed': 1.5,
        'comprehensive': 2.0
      };

      const multiplier = tokenMultipliers[adjustments.detailLevel] || 1.0;

      session.taskPlan.subtasks.forEach(subtask => {
        subtask.estimated_tokens = Math.round(subtask.estimated_tokens * multiplier);
      });
    }

    if (adjustments.includeExamples !== undefined) {
      // 添加或移除示例生成步骤
      if (adjustments.includeExamples) {
        // 检查是否已有示例步骤
        const hasExampleStep = session.taskPlan.subtasks.some(
          st => st.type === 'example' || st.title?.includes('示例')
        );

        if (!hasExampleStep) {
          // 添加示例生成步骤
          session.taskPlan.subtasks.push({
            id: uuidv4(),
            title: '生成使用示例',
            description: '创建代码示例和使用场景演示',
            type: 'example',
            estimated_tokens: 500,
            order: session.taskPlan.subtasks.length + 1,
            status: 'pending',
          });
        }
      } else {
        // 移除示例步骤
        session.taskPlan.subtasks = session.taskPlan.subtasks.filter(
          st => st.type !== 'example' && !st.title?.includes('示例')
        );

        // 重新编号
        session.taskPlan.subtasks.forEach((st, idx) => {
          st.order = idx + 1;
        });
      }
    }

    // 重新格式化Plan
    const updatedPlan = this.formatPlanForUser(session);

    return {
      sessionId,
      status: 'awaiting_confirmation',
      plan: updatedPlan,
      message: 'Plan已更新，请确认'
    };
  }

  /**
   * 应用模板
   */
  async applyTemplate(sessionId, templateId) {
    const session = this.planSessions.get(sessionId);

    logger.info('[InteractiveTaskPlanner] 应用模板:', templateId);

    try {
      // 获取模板
      const template = await this.templateManager.getTemplate(templateId);

      if (!template) {
        throw new Error(`模板不存在: ${templateId}`);
      }

      // 使用模板生成新的任务计划
      const templateBasedPlan = await this.generatePlanFromTemplate(
        template,
        session.userRequest,
        session.projectContext
      );

      session.taskPlan = templateBasedPlan;
      session.appliedTemplate = template;

      // 重新格式化Plan
      const updatedPlan = this.formatPlanForUser(session);

      return {
        sessionId,
        status: 'awaiting_confirmation',
        plan: updatedPlan,
        message: `已应用模板"${template.title}"，请确认`
      };

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 应用模板失败:', error);
      return {
        sessionId,
        status: 'error',
        error: error.message,
        message: '应用模板失败'
      };
    }
  }

  /**
   * 从模板生成Plan
   */
  async generatePlanFromTemplate(template, userRequest, projectContext) {
    const planId = uuidv4();
    const now = Date.now();

    // 解析模板结构
    const templateSteps = template.steps || template.subtasks || [];
    const templateFields = template.fields || {};
    const templateVariables = template.variables || {};

    // 将用户请求中的信息提取为变量值
    const extractedVariables = this.extractVariablesFromRequest(
      userRequest,
      templateVariables
    );

    // 根据模板步骤生成子任务
    const subtasks = templateSteps.map((step, index) => {
      // 替换步骤中的变量占位符
      const title = this.replaceVariables(step.title || step.name, extractedVariables);
      const description = this.replaceVariables(step.description || '', extractedVariables);

      return {
        id: uuidv4(),
        title,
        description,
        type: step.type || 'task',
        order: index + 1,
        estimated_tokens: step.estimatedTokens || step.estimated_tokens || 200,
        dependencies: step.dependencies || [],
        tools: step.tools || [],
        status: 'pending',
      };
    });

    // 如果模板没有步骤，创建基础步骤
    if (subtasks.length === 0) {
      subtasks.push(
        {
          id: uuidv4(),
          title: '分析需求',
          description: `分析用户需求: ${userRequest}`,
          type: 'analysis',
          order: 1,
          estimated_tokens: 200,
          status: 'pending',
        },
        {
          id: uuidv4(),
          title: '执行任务',
          description: template.description || '根据模板执行主要任务',
          type: 'execution',
          order: 2,
          estimated_tokens: 500,
          status: 'pending',
        },
        {
          id: uuidv4(),
          title: '验证结果',
          description: '验证输出是否满足需求',
          type: 'validation',
          order: 3,
          estimated_tokens: 100,
          status: 'pending',
        }
      );
    }

    // 确定输出文件
    const outputFiles = [];
    if (template.outputFiles) {
      for (const file of template.outputFiles) {
        outputFiles.push({
          path: this.replaceVariables(file.path || file, extractedVariables),
          type: file.type || 'code',
        });
      }
    }

    // 计算预估时长
    const totalTokens = subtasks.reduce((sum, st) => sum + (st.estimated_tokens || 0), 0);
    const estimatedMinutes = Math.ceil(totalTokens / 500); // 假设每500 token约1分钟

    return {
      id: planId,
      task_title: this.replaceVariables(template.title, extractedVariables),
      task_type: template.category || template.type || 'create',
      user_request: userRequest,
      template_id: template.id,
      template_name: template.title,
      estimated_duration: template.estimatedTime || `约${estimatedMinutes}分钟`,
      estimated_tokens: totalTokens,
      subtasks,
      variables: extractedVariables,
      final_output: {
        type: template.outputType || 'file',
        description: template.description || template.outputDescription,
        files: outputFiles,
      },
      context: projectContext,
      status: 'pending',
      created_at: now,
    };
  }

  /**
   * 从用户请求中提取变量值
   */
  extractVariablesFromRequest(request, templateVariables) {
    const extracted = {};

    for (const [varName, varConfig] of Object.entries(templateVariables)) {
      const pattern = varConfig.pattern || varConfig.regex;

      if (pattern) {
        // 使用正则表达式提取
        const regex = new RegExp(pattern, 'i');
        const match = request.match(regex);
        if (match) {
          extracted[varName] = match[1] || match[0];
        }
      } else if (varConfig.default) {
        extracted[varName] = varConfig.default;
      }
    }

    return extracted;
  }

  /**
   * 替换字符串中的变量占位符
   */
  replaceVariables(text, variables) {
    if (!text || typeof text !== 'string') return text;

    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      // 支持 {{variable}} 和 ${variable} 格式
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  /**
   * 重新生成Plan
   */
  async regeneratePlan(sessionId, feedback) {
    const session = this.planSessions.get(sessionId);

    logger.info('[InteractiveTaskPlanner] 重新生成Plan，用户反馈:', feedback);

    // 结合用户反馈重新生成
    const enhancedRequest = feedback
      ? `${session.userRequest}\n\n用户反馈：${feedback}`
      : session.userRequest;

    try {
      const newTaskPlan = await this.generateTaskPlan(enhancedRequest, session.projectContext);
      session.taskPlan = newTaskPlan;

      // 重新推荐资源
      session.recommendedTemplates = await this.recommendTemplates(enhancedRequest, session.projectContext, newTaskPlan);
      session.recommendedSkills = await this.recommendSkills(enhancedRequest, session.projectContext, newTaskPlan);
      session.recommendedTools = await this.recommendTools(enhancedRequest, session.projectContext, newTaskPlan);

      const updatedPlan = this.formatPlanForUser(session);

      return {
        sessionId,
        status: 'awaiting_confirmation',
        plan: updatedPlan,
        message: 'Plan已重新生成，请确认'
      };

    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 重新生成失败:', error);
      return {
        sessionId,
        status: 'error',
        error: error.message,
        message: '重新生成失败'
      };
    }
  }

  /**
   * 评估生成质量
   */
  async evaluateQuality(session) {
    logger.info('[InteractiveTaskPlanner] 开始质量评估');

    const { taskPlan, executionResult } = session;

    let totalScore = 0;
    let maxScore = 0;

    // 1. 完成度评分 (0-30分)
    maxScore += 30;
    if (executionResult && executionResult.success) {
      const completedSubtasks = taskPlan.subtasks.filter(s => s.status === 'completed').length;
      const completionRate = completedSubtasks / taskPlan.subtasks.length;
      totalScore += Math.round(completionRate * 30);
    }

    // 2. 文件输出评分 (0-20分)
    maxScore += 20;
    if (executionResult && executionResult.results) {
      const filesGenerated = executionResult.results.filter(r => r.success).length;
      const expectedFiles = taskPlan.final_output.files?.length || 1;
      const fileScore = Math.min(filesGenerated / expectedFiles, 1.0) * 20;
      totalScore += Math.round(fileScore);
    }

    // 3. 执行时间评分 (0-15分)
    maxScore += 15;
    if (session.completedAt && session.executionStartedAt) {
      const actualDuration = session.completedAt - session.executionStartedAt;
      const estimatedMs = this.parseEstimatedDuration(taskPlan.estimated_duration);

      if (estimatedMs > 0) {
        const timeRatio = actualDuration / estimatedMs;
        // 在预估时间内完成得满分，超时会扣分
        const timeScore = timeRatio <= 1.0 ? 15 : Math.max(0, 15 - (timeRatio - 1) * 10);
        totalScore += Math.round(timeScore);
      } else {
        totalScore += 10; // 无法估算，给基础分
      }
    }

    // 4. 错误率评分 (0-20分)
    maxScore += 20;
    const failedSubtasks = taskPlan.subtasks.filter(s => s.status === 'failed').length;
    const errorRate = failedSubtasks / taskPlan.subtasks.length;
    totalScore += Math.round((1 - errorRate) * 20);

    // 5. 资源使用评分 (0-15分)
    maxScore += 15;
    // 简化处理，使用默认分
    totalScore += 12;

    // 计算百分比
    const scorePercentage = Math.round((totalScore / maxScore) * 100);

    return {
      totalScore,
      maxScore,
      percentage: scorePercentage,
      grade: this.getGrade(scorePercentage),
      breakdown: {
        completion: Math.round((totalScore / maxScore) * 100),
        fileOutput: 20,
        executionTime: 15,
        errorRate: 20,
        resourceUsage: 15
      }
    };
  }

  /**
   * 解析预估时长
   */
  parseEstimatedDuration(duration) {
    if (!duration) {return 0;}

    const match = duration.match(/(\d+)\s*(分钟|秒|小时)/);
    if (!match) {return 0;}

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case '秒': return value * 1000;
      case '分钟': return value * 60 * 1000;
      case '小时': return value * 60 * 60 * 1000;
      default: return 0;
    }
  }

  /**
   * 获取等级
   */
  getGrade(percentage) {
    if (percentage >= 90) {return 'A';}
    if (percentage >= 80) {return 'B';}
    if (percentage >= 70) {return 'C';}
    if (percentage >= 60) {return 'D';}
    return 'F';
  }

  /**
   * 收集用户反馈
   * @param {string} sessionId - 会话ID
   * @param {Object} feedback - 用户反馈
   */
  async submitUserFeedback(sessionId, feedback) {
    const session = this.planSessions.get(sessionId);

    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    session.userFeedback = {
      ...feedback,
      submittedAt: Date.now()
    };

    // 保存反馈到数据库
    try {
      await this.saveFeedbackToDatabase(sessionId, feedback);
    } catch (error) {
      logger.error('[InteractiveTaskPlanner] 保存反馈失败:', error);
    }

    this.emit('feedback-submitted', { sessionId, feedback });

    return {
      success: true,
      message: '感谢您的反馈'
    };
  }

  /**
   * 保存反馈到数据库
   */
  async saveFeedbackToDatabase(sessionId, feedback) {
    const { rating, comment, issues, suggestions } = feedback;

    const sql = `
      INSERT INTO task_plan_feedback (
        id, session_id, rating, comment, issues, suggestions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    this.database.run(sql, [
      uuidv4(),
      sessionId,
      rating || null,
      comment || null,
      JSON.stringify(issues || []),
      JSON.stringify(suggestions || []),
      Date.now()
    ]);
  }

  /**
   * 获取会话信息
   */
  getSession(sessionId) {
    return this.planSessions.get(sessionId);
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions(maxAge = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.planSessions.entries()) {
      const age = now - session.createdAt;

      if (age > maxAge && (session.status === 'completed' || session.status === 'cancelled' || session.status === 'failed')) {
        this.planSessions.delete(sessionId);
        cleanedCount++;
      }
    }

    logger.info(`[InteractiveTaskPlanner] 清理了${cleanedCount}个过期会话`);
    return cleanedCount;
  }
}

module.exports = InteractiveTaskPlanner;
