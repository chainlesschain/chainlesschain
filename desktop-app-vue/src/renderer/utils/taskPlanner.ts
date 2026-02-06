/**
 * 对话式任务规划助手
 * 类似Claude Code的plan模式，通过对话收集信息并制定详细计划
 */

import { logger } from '@/utils/logger';

// ==================== 类型定义 ====================

/**
 * 规划状态枚举
 */
export const PlanningState = {
  IDLE: 'idle',
  ANALYZING: 'analyzing',
  INTERVIEWING: 'interviewing',
  PLANNING: 'planning',
  CONFIRMING: 'confirming',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
} as const;

export type PlanningStateValue = typeof PlanningState[keyof typeof PlanningState];

/**
 * 问题选项
 */
export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

/**
 * 采访问题
 */
export interface InterviewQuestion {
  key: string;
  question: string;
  required: boolean;
  answered?: boolean;
  options?: QuestionOption[];
  allowCustom?: boolean;
}

/**
 * 结构化答案
 */
export interface StructuredAnswer {
  selectedOption?: string;
  additionalInput?: string;
}

/**
 * 任务项
 */
export interface TaskItem {
  id: number;
  name: string;
  description: string;
  action: string;
  output: string;
}

/**
 * 任务计划
 */
export interface TaskPlan {
  title: string;
  summary: string;
  tasks: TaskItem[];
  resources?: string[];
  estimatedDuration?: string;
  outputs: string[];
  notes?: string[];
}

/**
 * 需求分析结果
 */
export interface RequirementAnalysis {
  isComplete: boolean;
  confidence: number;
  missing: string[];
  collected: Record<string, string>;
  needsInterview?: boolean;
  suggestedQuestions?: InterviewQuestion[];
  suggestions?: string[];
}

/**
 * LLM 服务接口
 */
export interface LLMService {
  chat: (prompt: string) => Promise<string>;
}

// ==================== 类实现 ====================

/**
 * 任务规划会话
 */
export class PlanningSession {
  id: string;
  state: PlanningStateValue;
  userInput: string;
  projectType: string;
  analysis: {
    isComplete: boolean;
    confidence: number;
    missing: string[];
    collected: Record<string, string>;
    suggestions: string[];
  };
  interview: {
    questions: InterviewQuestion[];
    currentIndex: number;
    answers: Record<string, string | StructuredAnswer>;
    completed: boolean;
  };
  plan: TaskPlan;
  confirmed: boolean;
  createdAt: number;
  updatedAt: number;

  constructor(userInput: string, projectType: string = 'document') {
    this.id = `plan_${Date.now()}`;
    this.state = PlanningState.IDLE;
    this.userInput = userInput;
    this.projectType = projectType;

    this.analysis = {
      isComplete: false,
      confidence: 0,
      missing: [],
      collected: {},
      suggestions: []
    };

    this.interview = {
      questions: [],
      currentIndex: 0,
      answers: {},
      completed: false
    };

    this.plan = {
      title: '',
      summary: '',
      tasks: [],
      resources: [],
      estimatedDuration: '',
      outputs: []
    };

    this.confirmed = false;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * 更新状态
   */
  setState(newState: PlanningStateValue): void {
    this.state = newState;
    this.updatedAt = Date.now();
  }

  /**
   * 添加已收集的信息
   */
  addCollectedInfo(key: string, value: string): void {
    this.analysis.collected[key] = value;
    this.updatedAt = Date.now();
  }

  /**
   * 添加采访问题
   */
  addQuestion(question: string, key: string, required: boolean = true): void {
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
  recordAnswer(questionIndex: number, answer: string | StructuredAnswer): void {
    if (questionIndex < this.interview.questions.length) {
      const question = this.interview.questions[questionIndex];
      question.answered = true;
      this.interview.answers[question.key] = answer;

      const stringValue = typeof answer === 'string'
        ? answer
        : `${answer.selectedOption || ''}${answer.additionalInput ? ` - ${answer.additionalInput}` : ''}`;
      this.addCollectedInfo(question.key, stringValue);
    }
  }

  /**
   * 是否还有未回答的问题
   */
  hasMoreQuestions(): boolean {
    return this.interview.currentIndex < this.interview.questions.length;
  }

  /**
   * 获取下一个问题
   */
  getNextQuestion(): InterviewQuestion | null {
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
  setPlan(plan: Partial<TaskPlan>): void {
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
   */
  static async analyzeRequirements(
    userInput: string,
    projectType: string,
    llmService: LLMService
  ): Promise<RequirementAnalysis> {
    logger.info('[TaskPlanner] 开始分析需求完整性:', userInput);

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
    }
  ]
}`;

    try {
      logger.info('[TaskPlanner] 开始调用LLM，设置10分钟超时...');

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LLM调用超时（10分钟）')), 600000);
      });

      const response = await Promise.race([
        llmService.chat(prompt),
        timeoutPromise
      ]);

      logger.info('[TaskPlanner] ✅ LLM响应成功，长度:', response?.length || 0);

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analysis: RequirementAnalysis = JSON.parse(jsonMatch[0]);
        logger.info('[TaskPlanner] 需求分析完成:', analysis);
        return analysis;
      }

      logger.warn('[TaskPlanner] 无法解析分析结果，使用默认值');
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
      logger.error('[TaskPlanner] ❌ 需求分析失败:', error);

      logger.warn('[TaskPlanner] 使用降级方案：返回默认采访问题');

      const defaultQuestions: Record<string, InterviewQuestion[]> = {
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
   */
  static async generatePlan(session: PlanningSession, llmService: LLMService): Promise<TaskPlan> {
    logger.info('[TaskPlanner] 开始生成任务计划');

    const collectedInfo = Object.entries(session.analysis.collected)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join('\n');

    const interviewAnswers = Object.entries(session.interview.answers)
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'selectedOption' in value) {
          const optionText = value.selectedOption || '(未选择)';
          const additionalText = value.additionalInput ? ` - ${value.additionalInput}` : '';
          return `- ${key}: ${optionText}${additionalText}`;
        }
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
      logger.info('[TaskPlanner] LLM响应:', response);
      logger.info('[TaskPlanner] 响应长度:', response?.length || 0);

      if (!response || response.length === 0) {
        throw new Error('LLM返回空响应');
      }

      let jsonText: string | null = null;

      const codeBlockMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
        logger.info('[TaskPlanner] 从代码块中提取JSON');
      }

      if (!jsonText) {
        const jsonMatch = response.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
          logger.info('[TaskPlanner] 使用简单匹配提取JSON');
        }
      }

      if (!jsonText) {
        const firstBrace = response.indexOf('{');
        const lastBrace = response.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          jsonText = response.substring(firstBrace, lastBrace + 1);
          logger.info('[TaskPlanner] 使用{}匹配提取JSON');
        }
      }

      if (!jsonText) {
        logger.error('[TaskPlanner] 无法从响应中提取JSON');
        logger.error('[TaskPlanner] 完整响应:', response);
        throw new Error('响应中未找到JSON格式的任务计划');
      }

      let plan: TaskPlan;
      try {
        plan = JSON.parse(jsonText);
        logger.info('[TaskPlanner] JSON解析成功:', plan);
      } catch (parseError) {
        logger.error('[TaskPlanner] JSON解析失败:', parseError);
        logger.error('[TaskPlanner] 尝试解析的文本:', jsonText);
        throw new Error(`JSON解析失败: ${(parseError as Error).message}`);
      }

      if (!plan.title || !plan.tasks || !Array.isArray(plan.tasks)) {
        logger.warn('[TaskPlanner] 计划缺少必要字段，使用默认值补充');
        plan.title = plan.title || '任务执行计划';
        plan.summary = plan.summary || '根据您的需求生成的任务计划';
        plan.tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
        plan.outputs = plan.outputs || [];
        plan.notes = plan.notes || [];
      }

      logger.info('[TaskPlanner] 任务计划生成完成:', plan);
      return plan;

    } catch (error) {
      logger.error('[TaskPlanner] 任务计划生成失败:', error);

      logger.warn('[TaskPlanner] 使用降级方案：生成默认任务计划');

      const defaultPlan: TaskPlan = {
        title: `执行计划：${session.userInput}`,
        summary: `根据您的需求"${session.userInput}"，我们将分步骤完成任务。`,
        tasks: [
          {
            id: 1,
            name: '需求分析',
            description: '详细分析用户需求',
            action: `分析"${session.userInput}"的具体要求`,
            output: '需求分析报告'
          },
          {
            id: 2,
            name: '方案设计',
            description: '设计实施方案',
            action: '根据需求设计具体实施方案',
            output: '实施方案文档'
          },
          {
            id: 3,
            name: '执行实施',
            description: '按照方案执行',
            action: '按照设计的方案逐步实施',
            output: '任务成果'
          },
          {
            id: 4,
            name: '验证优化',
            description: '验证结果并优化',
            action: '检查成果质量并进行必要的优化',
            output: '最终成果'
          }
        ],
        outputs: ['最终成果文档', '相关文件'],
        notes: ['请根据实际情况调整计划', '遇到问题及时沟通']
      };

      logger.info('[TaskPlanner] 返回默认计划:', defaultPlan);
      return defaultPlan;
    }
  }

  /**
   * 格式化计划为Markdown
   */
  static formatPlanAsMarkdown(plan: TaskPlan): string {
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
