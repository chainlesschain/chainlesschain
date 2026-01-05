/**
 * 对话式任务规划助手
 * 类似Claude Code的plan模式，通过对话收集信息并制定详细计划
 */

/**
 * 规划状态
 */
export const PlanningState = {
  IDLE: 'idle',                    // 空闲状态
  ANALYZING: 'analyzing',          // 分析需求
  INTERVIEWING: 'interviewing',    // 采访用户
  PLANNING: 'planning',            // 生成计划
  CONFIRMING: 'confirming',        // 等待确认
  EXECUTING: 'executing',          // 执行任务
  COMPLETED: 'completed',          // 已完成
  CANCELLED: 'cancelled'           // 已取消
};

/**
 * 任务规划会话
 */
export class PlanningSession {
  constructor(userInput, projectType = 'document') {
    this.id = `plan_${Date.now()}`;
    this.state = PlanningState.IDLE;
    this.userInput = userInput;
    this.projectType = projectType;

    // 需求分析结果
    this.analysis = {
      isComplete: false,           // 需求是否完整
      confidence: 0,               // 完整性置信度
      missing: [],                 // 缺失的信息
      collected: {},               // 已收集的信息
      suggestions: []              // 建议
    };

    // 采访数据
    this.interview = {
      questions: [],               // 问题列表
      currentIndex: 0,             // 当前问题索引
      answers: {},                 // 用户答案
      completed: false             // 是否完成
    };

    // 任务计划
    this.plan = {
      title: '',                   // 计划标题
      summary: '',                 // 摘要
      tasks: [],                   // 任务列表
      resources: [],               // 需要的资源
      estimatedDuration: '',       // 预估时长
      outputs: []                  // 预期输出
    };

    this.confirmed = false;        // 计划是否确认
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * 更新状态
   */
  setState(newState) {
    this.state = newState;
    this.updatedAt = Date.now();
  }

  /**
   * 添加已收集的信息
   */
  addCollectedInfo(key, value) {
    this.analysis.collected[key] = value;
    this.updatedAt = Date.now();
  }

  /**
   * 添加采访问题
   */
  addQuestion(question, key, required = true) {
    this.interview.questions.push({
      question,
      key,
      required,
      answered: false
    });
  }

  /**
   * 记录答案
   */
  recordAnswer(questionIndex, answer) {
    if (questionIndex < this.interview.questions.length) {
      const question = this.interview.questions[questionIndex];
      question.answered = true;
      this.interview.answers[question.key] = answer;
      this.addCollectedInfo(question.key, answer);
    }
  }

  /**
   * 是否还有未回答的问题
   */
  hasMoreQuestions() {
    return this.interview.currentIndex < this.interview.questions.length;
  }

  /**
   * 获取下一个问题
   */
  getNextQuestion() {
    if (this.hasMoreQuestions()) {
      const question = this.interview.questions[this.interview.currentIndex];
      this.interview.currentIndex++;
      return question;
    }
    return null;
  }

  /**
   * 设置任务计划
   */
  setPlan(plan) {
    this.plan = { ...this.plan, ...plan };
    this.updatedAt = Date.now();
  }
}

/**
 * 任务规划器
 */
export class TaskPlanner {
  /**
   * 分析需求完整性
   * @param {string} userInput - 用户输入
   * @param {string} projectType - 项目类型
   * @param {Object} llmService - LLM服务
   * @returns {Promise<Object>} 分析结果
   */
  static async analyzeRequirements(userInput, projectType, llmService) {
    console.log('[TaskPlanner] 开始分析需求完整性:', userInput);

    const prompt = `请分析以下用户需求的完整性：

用户输入: "${userInput}"
项目类型: ${projectType}

请从以下维度分析需求是否完整：
1. 目标明确性 - 用户想要什么？
2. 内容要求 - 需要包含什么内容？
3. 格式规格 - 输出格式是什么？
4. 受众对象 - 面向谁？
5. 风格偏好 - 什么风格？
6. 其他约束 - 还有什么要求？

【重要】对于每个需要询问的问题，请提供2-4个常见选项，帮助用户快速选择：
- 选项应涵盖该问题的典型答案（如正式/轻松、初学者/专业人士等）
- 用户可以选择选项后补充说明，或完全自定义答案
- 每个选项包含：value（选项值）、label（显示文本）、description（说明，可选）

请返回JSON格式：
{
  "isComplete": true/false,
  "confidence": 0.0-1.0,
  "missing": ["缺失的信息1", "缺失的信息2"],
  "collected": {
    "目标": "...",
    "格式": "..."
  },
  "needsInterview": true/false,
  "suggestedQuestions": [
    {
      "key": "audience",
      "question": "这份文档的目标受众是谁？",
      "required": true,
      "options": [
        {"value": "beginner", "label": "初学者/新手", "description": "需要详细解释基础概念"},
        {"value": "professional", "label": "专业人士", "description": "可以使用行业术语"},
        {"value": "general", "label": "普通大众", "description": "通俗易懂的语言"}
      ],
      "allowCustom": true
    },
    {
      "key": "style",
      "question": "您期望的风格是？",
      "required": false,
      "options": [
        {"value": "formal", "label": "正式专业"},
        {"value": "casual", "label": "轻松随意"},
        {"value": "technical", "label": "技术性强"}
      ],
      "allowCustom": true
    }
  ]
}

【提示】如果无法生成选项，可以省略options字段，系统会回退到普通文本框。`;

    try {
      console.log('[TaskPlanner] 开始调用LLM，设置10分钟超时...');

      // 🔥 添加超时机制（10分钟 = 600秒）
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('LLM调用超时（10分钟）')), 600000);
      });

      const response = await Promise.race([
        llmService.chat(prompt),
        timeoutPromise
      ]);

      console.log('[TaskPlanner] ✅ LLM响应成功，长度:', response?.length || 0);

      // 尝试提取JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis = JSON.parse(jsonMatch[0]);
        console.log('[TaskPlanner] 需求分析完成:', analysis);
        return analysis;
      }

      // 如果没有JSON，返回默认结果（假设需求不完整）
      console.warn('[TaskPlanner] 无法解析分析结果，使用默认值');
      return {
        isComplete: false,
        confidence: 0.5,
        missing: ['详细要求'],
        collected: {},
        needsInterview: true,
        suggestedQuestions: [
          { key: 'details', question: '能否详细描述一下您的需求？', required: true }
        ]
      };
    } catch (error) {
      console.error('[TaskPlanner] ❌ 需求分析失败:', error);

      // 🔥 降级方案：返回基于项目类型的默认问题
      console.warn('[TaskPlanner] 使用降级方案：返回默认采访问题');

      const defaultQuestions = {
        document: [
          {
            key: 'audience',
            question: '这份文档的目标受众是谁？',
            required: true,
            options: [
              { value: 'beginner', label: '初学者/新手', description: '需要详细解释基础概念' },
              { value: 'professional', label: '专业人士', description: '可以使用行业术语' },
              { value: 'general', label: '普通大众', description: '通俗易懂的语言' }
            ],
            allowCustom: true
          },
          {
            key: 'style',
            question: '您期望的风格是？',
            required: false,
            options: [
              { value: 'formal', label: '正式专业', description: '适合商务、学术场景' },
              { value: 'casual', label: '轻松随意', description: '适合日常交流' },
              { value: 'technical', label: '技术性强', description: '包含详细技术细节' },
              { value: 'creative', label: '创意活泼', description: '生动有趣的表达' }
            ],
            allowCustom: true
          },
          {
            key: 'length',
            question: '文档大概需要多长？',
            required: false,
            options: [
              { value: 'short', label: '简短（1-2页）', description: '约500-1000字' },
              { value: 'medium', label: '中等（3-5页）', description: '约1500-3000字' },
              { value: 'long', label: '详细（5页以上）', description: '3000字以上' }
            ],
            allowCustom: true
          },
        ],
        web: [
          {
            key: 'purpose',
            question: '这个网页的主要目的是什么？',
            required: true,
            options: [
              { value: 'marketing', label: '营销推广', description: '产品或服务宣传' },
              { value: 'information', label: '信息展示', description: '展示内容和资讯' },
              { value: 'ecommerce', label: '电商销售', description: '在线购物功能' },
              { value: 'community', label: '社区互动', description: '用户交流平台' }
            ],
            allowCustom: true
          },
          {
            key: 'target_users',
            question: '目标用户群体是谁？',
            required: false,
            options: [
              { value: 'youth', label: '年轻用户（18-30岁）' },
              { value: 'professional', label: '职场人士' },
              { value: 'senior', label: '中老年用户' },
              { value: 'all', label: '全年龄段' }
            ],
            allowCustom: true
          },
          {
            key: 'features',
            question: '需要哪些主要功能？',
            required: true,
            options: [
              { value: 'basic', label: '基础展示', description: '文字、图片展示' },
              { value: 'interactive', label: '交互功能', description: '表单、评论、搜索等' },
              { value: 'advanced', label: '高级功能', description: '用户系统、支付等' }
            ],
            allowCustom: true
          },
        ],
        data: [
          {
            key: 'data_source',
            question: '数据来源是什么？',
            required: true,
            options: [
              { value: 'csv', label: 'CSV文件' },
              { value: 'excel', label: 'Excel表格' },
              { value: 'database', label: '数据库' },
              { value: 'api', label: 'API接口' }
            ],
            allowCustom: true
          },
          {
            key: 'analysis_goal',
            question: '分析的目标是什么？',
            required: true,
            options: [
              { value: 'visualization', label: '数据可视化', description: '图表展示' },
              { value: 'statistics', label: '统计分析', description: '计算指标和趋势' },
              { value: 'report', label: '分析报告', description: '生成完整报告' }
            ],
            allowCustom: true
          },
        ]
      };

      const questions = defaultQuestions[projectType] || defaultQuestions.document;

      return {
        isComplete: false,
        confidence: 0.3,
        missing: ['具体需求细节'],
        collected: { userInput },
        needsInterview: true,
        suggestedQuestions: questions
      };
    }
  }

  /**
   * 生成任务计划
   * @param {PlanningSession} session - 规划会话
   * @param {Object} llmService - LLM服务
   * @returns {Promise<Object>} 任务计划
   */
  static async generatePlan(session, llmService) {
    console.log('[TaskPlanner] 开始生成任务计划');

    // 构建上下文
    const collectedInfo = Object.entries(session.analysis.collected)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');

    const interviewAnswers = Object.entries(session.interview.answers)
      .map(([key, value]) => {
        // 处理结构化答案（新格式）
        if (typeof value === 'object' && value !== null && value.selectedOption !== undefined) {
          const optionText = value.selectedOption || '(未选择)';
          const additionalText = value.additionalInput ? ` - ${value.additionalInput}` : '';
          return `- ${key}: ${optionText}${additionalText}`;
        }
        // 处理传统字符串答案（旧格式，保持兼容）
        return `- ${key}: ${value}`;
      })
      .join('\n');

    const prompt = `基于以下信息，请生成详细的任务执行计划：

原始需求: "${session.userInput}"
项目类型: ${session.projectType}

已收集的信息:
${collectedInfo}

采访得到的补充信息:
${interviewAnswers}

请生成一个详细的任务计划，包括：
1. 计划标题和摘要
2. 详细的任务步骤（每个步骤要具体可执行）
3. 预期输出
4. 注意事项

返回JSON格式：
{
  "title": "任务计划标题",
  "summary": "计划摘要，2-3句话",
  "tasks": [
    {
      "id": 1,
      "name": "任务名称",
      "description": "详细描述",
      "action": "具体要做什么",
      "output": "预期输出是什么"
    }
  ],
  "outputs": ["最终输出1", "最终输出2"],
  "notes": ["注意事项1", "注意事项2"]
}`;

    try {
      const response = await llmService.chat(prompt);

      // 提取JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        console.log('[TaskPlanner] 任务计划生成完成:', plan);
        return plan;
      }

      throw new Error('无法解析任务计划');
    } catch (error) {
      console.error('[TaskPlanner] 任务计划生成失败:', error);
      throw error;
    }
  }

  /**
   * 格式化计划为Markdown
   * @param {Object} plan - 任务计划
   * @returns {string} Markdown格式的计划
   */
  static formatPlanAsMarkdown(plan) {
    let markdown = `# ${plan.title}\n\n`;
    markdown += `${plan.summary}\n\n`;

    markdown += `## 📋 任务步骤\n\n`;
    plan.tasks.forEach((task, index) => {
      markdown += `### ${index + 1}. ${task.name}\n\n`;
      markdown += `**描述**: ${task.description}\n\n`;
      markdown += `**操作**: ${task.action}\n\n`;
      markdown += `**输出**: ${task.output}\n\n`;
      markdown += `---\n\n`;
    });

    if (plan.outputs && plan.outputs.length > 0) {
      markdown += `## 🎯 预期输出\n\n`;
      plan.outputs.forEach(output => {
        markdown += `- ${output}\n`;
      });
      markdown += '\n';
    }

    if (plan.notes && plan.notes.length > 0) {
      markdown += `## ⚠️ 注意事项\n\n`;
      plan.notes.forEach(note => {
        markdown += `- ${note}\n`;
      });
      markdown += '\n';
    }

    return markdown;
  }
}

export default TaskPlanner;
