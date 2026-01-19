/**
 * AI任务智能拆解系统
 * 负责将用户的复杂需求拆解为可执行的子任务
 * 参考: 系统设计文档 2.4.6节
 */

const { getLLMService } = require('../llm/llm-manager');
const { getProjectRAGManager } = require('../project/project-rag');

/**
 * 任务规划器
 */
class TaskPlanner {
  constructor() {
    this.llmService = null;
    this.ragManager = null;
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) {return;}

    try {
      this.llmService = getLLMService();
      this.ragManager = getProjectRAGManager();
      await this.ragManager.initialize();
      this.initialized = true;
      console.log('[TaskPlanner] 初始化完成');
    } catch (error) {
      console.warn('[TaskPlanner] 初始化失败，部分功能可能不可用:', error.message);
    }
  }

  /**
   * 拆解用户任务
   * @param {string} userRequest - 用户需求描述
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} 任务计划
   */
  async decomposeTask(userRequest, projectContext) {
    console.log('[TaskPlanner] 开始拆解任务:', userRequest);

    await this.initialize();

    try {
      // 1. 使用RAG增强项目上下文
      let enhancedContext = '';
      if (projectContext.projectId && this.ragManager) {
        try {
          const ragResult = await this.ragManager.enhancedQuery(
            projectContext.projectId,
            userRequest,
            {
              projectLimit: 3,
              knowledgeLimit: 2,
              conversationLimit: 2
            }
          );

          if (ragResult.context && ragResult.context.length > 0) {
            enhancedContext = '\n\n## 相关知识:\n' + ragResult.context
              .map((doc, idx) => `${idx + 1}. ${doc.metadata?.fileName || '未知来源'}: ${doc.content.substring(0, 200)}...`)
              .join('\n');
          }
        } catch (error) {
          console.warn('[TaskPlanner] RAG增强失败，继续执行', error);
        }
      }

      // 2. 构建提示词
      const prompt = this.buildDecompositionPrompt(userRequest, projectContext, enhancedContext);

      // 3. 调用LLM生成任务计划
      const result = await this.llmService.complete({
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,  // 降低温度，使输出更确定
        max_tokens: 2000
      });

      // 4. 解析LLM返回的JSON
      let taskPlan;
      try {
        // 提取JSON部分（可能包含markdown代码块）
        const jsonMatch = result.match(/```json\n([\s\S]*?)\n```/) || result.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : result;

        taskPlan = JSON.parse(jsonStr);
      } catch (error) {
        console.error('[TaskPlanner] 解析JSON失败，使用快速拆解模式');
        return this.quickDecompose(userRequest, projectContext);
      }

      // 5. 验证和增强任务计划
      const validatedPlan = this.validateAndEnhancePlan(taskPlan, projectContext);

      console.log('[TaskPlanner] 任务拆解完成:', validatedPlan);
      return validatedPlan;

    } catch (error) {
      console.error('[TaskPlanner] 任务拆解失败，使用快速拆解模式:', error);
      return this.quickDecompose(userRequest, projectContext);
    }
  }

  /**
   * 获取系统提示词
   */
  getSystemPrompt() {
    return `你是ChainlessChain项目管理系统的AI任务规划助手。你的职责是将用户的需求拆解为清晰、可执行的子任务。

# 核心能力
1. 理解用户意图，识别项目类型和目标
2. 将复杂任务拆解为有依赖关系的子任务
3. 为每个子任务选择合适的工具引擎
4. 估算任务复杂度和所需资源

# 可用工具引擎
- web-engine: HTML/CSS/JavaScript网页开发
- document-engine: Word/PDF/Markdown文档处理
- data-engine: Excel/CSV数据分析和可视化
- ppt-engine: PowerPoint演示文稿生成
- code-engine: 代码生成和开发辅助
- image-engine: 图像设计和处理
- video-engine: 视频处理和编辑

# 输出格式要求
必须返回严格的JSON格式，结构如下：
\`\`\`json
{
  "task_title": "任务总标题",
  "task_type": "项目类型(web/document/data/ppt/code/mixed)",
  "estimated_duration": 20,
  "subtasks": [
    {
      "step": 1,
      "title": "子任务标题",
      "description": "详细描述要做什么",
      "tool": "使用的工具引擎",
      "estimated_tokens": 1000,
      "dependencies": [],
      "output_files": ["预期生成的文件名"]
    }
  ],
  "final_deliverables": ["最终交付物列表"]
}
\`\`\`

# 注意事项
1. 子任务要具体、可执行
2. 合理设置依赖关系（后续步骤依赖前序步骤）
3. 估算要合理（简单任务500-1000 tokens，复杂任务2000-4000 tokens）
4. 输出必须是纯JSON，不要包含任何其他文字说明`;
  }

  /**
   * 构建任务拆解提示词
   */
  buildDecompositionPrompt(userRequest, projectContext, enhancedContext) {
    let prompt = `# 用户需求\n${userRequest}\n\n`;

    // 添加项目上下文
    prompt += `# 项目信息\n`;
    prompt += `- 项目类型: ${projectContext.type || '未指定'}\n`;

    if (projectContext.existingFiles && projectContext.existingFiles.length > 0) {
      prompt += `- 现有文件: ${projectContext.existingFiles.slice(0, 10).join(', ')}`;
      if (projectContext.existingFiles.length > 10) {
        prompt += ` (共${projectContext.existingFiles.length}个文件)`;
      }
      prompt += '\n';
    }

    if (projectContext.description) {
      prompt += `- 项目描述: ${projectContext.description}\n`;
    }

    // 添加RAG增强的上下文
    if (enhancedContext) {
      prompt += enhancedContext;
    }

    prompt += `\n# 任务要求\n请将上述用户需求拆解为详细的执行计划，以JSON格式返回。`;

    return prompt;
  }

  /**
   * 验证和增强任务计划
   */
  validateAndEnhancePlan(taskPlan, projectContext) {
    // 添加任务ID和时间戳
    const enhancedPlan = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      ...taskPlan,
      status: 'pending',
      progress_percentage: 0,
      current_step: 0,
      total_steps: taskPlan.subtasks?.length || 0,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      project_id: projectContext.projectId,
      project_name: projectContext.projectName || projectContext.name
    };

    // 为每个子任务添加ID和状态
    if (enhancedPlan.subtasks && enhancedPlan.subtasks.length > 0) {
      enhancedPlan.subtasks = enhancedPlan.subtasks.map((subtask, index) => ({
        id: `subtask_${Date.now()}_${index}`,
        ...subtask,
        step: index + 1,
        status: 'pending',
        started_at: null,
        completed_at: null,
        result: null,
        error: null,
        command: null
      }));
    }

    // 验证必需字段
    if (!enhancedPlan.task_title) {
      enhancedPlan.task_title = '未命名任务';
    }

    if (!enhancedPlan.task_type) {
      enhancedPlan.task_type = 'mixed';
    }

    if (!enhancedPlan.subtasks || enhancedPlan.subtasks.length === 0) {
      throw new Error('任务计划必须包含至少一个子任务');
    }

    return enhancedPlan;
  }

  /**
   * 根据文件类型推荐工具引擎
   * @param {string} taskDescription - 任务描述
   * @returns {string} 推荐的工具引擎
   */
  recommendTool(taskDescription) {
    const lowerDesc = taskDescription.toLowerCase();

    if (lowerDesc.includes('网页') || lowerDesc.includes('html') || lowerDesc.includes('website')) {
      return 'web-engine';
    }
    if (lowerDesc.includes('ppt') || lowerDesc.includes('演示') || lowerDesc.includes('幻灯片')) {
      return 'ppt-engine';
    }
    if (lowerDesc.includes('excel') || lowerDesc.includes('表格') || lowerDesc.includes('数据分析') || lowerDesc.includes('图表')) {
      return 'data-engine';
    }
    if (lowerDesc.includes('word') || lowerDesc.includes('文档') || lowerDesc.includes('pdf')) {
      return 'document-engine';
    }
    if (lowerDesc.includes('代码') || lowerDesc.includes('程序') || lowerDesc.includes('function') || lowerDesc.includes('class')) {
      return 'code-engine';
    }
    if (lowerDesc.includes('图片') || lowerDesc.includes('图像') || lowerDesc.includes('设计') || lowerDesc.includes('logo')) {
      return 'image-engine';
    }
    if (lowerDesc.includes('视频') || lowerDesc.includes('video')) {
      return 'video-engine';
    }

    return 'code-engine'; // 默认
  }

  /**
   * 评估任务复杂度
   * @param {string} taskDescription - 任务描述
   * @returns {Object} 复杂度评估
   */
  assessComplexity(taskDescription) {
    const wordCount = taskDescription.length;

    let complexity = 'simple';
    let estimatedTokens = 1000;

    if (wordCount > 200) {
      complexity = 'complex';
      estimatedTokens = 4000;
    } else if (wordCount > 100) {
      complexity = 'medium';
      estimatedTokens = 2000;
    }

    return {
      complexity,
      estimatedTokens,
      estimatedDuration: Math.ceil(estimatedTokens / 50) // 假设50 tokens/分钟
    };
  }

  /**
   * 简单任务快速拆解（不调用LLM）
   * 用于一些明确的单步任务或LLM调用失败时的fallback
   */
  quickDecompose(userRequest, projectContext) {
    console.log('[TaskPlanner] 使用快速拆解模式');

    const tool = this.recommendTool(userRequest);
    const complexity = this.assessComplexity(userRequest);

    return {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      task_title: userRequest.substring(0, 50) + (userRequest.length > 50 ? '...' : ''),
      task_type: this.getTaskTypeFromTool(tool),
      estimated_duration: complexity.estimatedDuration,
      status: 'pending',
      progress_percentage: 0,
      current_step: 0,
      total_steps: 1,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      project_id: projectContext.projectId,
      project_name: projectContext.projectName || projectContext.name,
      subtasks: [
        {
          id: `subtask_${Date.now()}_0`,
          step: 1,
          title: userRequest,
          description: userRequest,
          tool: tool,
          estimated_tokens: complexity.estimatedTokens,
          dependencies: [],
          output_files: [],
          status: 'pending',
          started_at: null,
          completed_at: null,
          result: null,
          error: null,
          command: null
        }
      ],
      final_deliverables: ['根据用户需求生成的文件']
    };
  }

  /**
   * 从工具名获取任务类型
   */
  getTaskTypeFromTool(tool) {
    const mapping = {
      'web-engine': 'web',
      'document-engine': 'document',
      'data-engine': 'data',
      'ppt-engine': 'ppt',
      'code-engine': 'code',
      'image-engine': 'image',
      'video-engine': 'video'
    };
    return mapping[tool] || 'mixed';
  }
}

// 单例模式
let taskPlanner = null;

/**
 * 获取任务规划器实例
 * @returns {TaskPlanner}
 */
function getTaskPlanner() {
  if (!taskPlanner) {
    taskPlanner = new TaskPlanner();
  }
  return taskPlanner;
}

module.exports = {
  TaskPlanner,
  getTaskPlanner
};
