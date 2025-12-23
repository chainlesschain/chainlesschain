/**
 * 任务规划器
 * 根据识别的意图生成执行计划
 * 支持模板化规划和动态规划
 */

class TaskPlanner {
  constructor() {
    // 预定义任务模板
    this.templates = {
      // 创建HTML网页
      create_html: {
        name: '创建HTML网页',
        steps: [
          {
            name: '创建项目结构',
            tool: 'create_project_structure',
            params: { type: 'web' },
          },
          {
            name: '生成HTML文件',
            tool: 'html_generator',
            params: { template: 'basic' },
          },
          {
            name: '生成CSS样式',
            tool: 'css_generator',
            params: { framework: 'custom' },
          },
          {
            name: '生成JavaScript代码',
            tool: 'js_generator',
            params: { features: [] },
          },
          {
            name: '初始化Git仓库',
            tool: 'git_init',
            params: {},
          },
        ],
      },

      // 创建文档
      create_document: {
        name: '创建文档',
        steps: [
          {
            name: '创建项目结构',
            tool: 'create_project_structure',
            params: { type: 'document' },
          },
          {
            name: '生成文档内容',
            tool: 'document_generator',
            params: { format: 'markdown' },
          },
        ],
      },

      // 编辑文件
      edit_file: {
        name: '编辑文件',
        steps: [
          {
            name: '读取文件内容',
            tool: 'file_reader',
            params: {},
          },
          {
            name: '应用修改',
            tool: 'file_editor',
            params: {},
          },
          {
            name: '保存文件',
            tool: 'file_writer',
            params: {},
          },
          {
            name: '提交Git更改',
            tool: 'git_commit',
            params: {},
          },
        ],
      },

      // 查询信息
      query_info: {
        name: '查询信息',
        steps: [
          {
            name: '搜索相关信息',
            tool: 'info_searcher',
            params: {},
          },
          {
            name: '格式化输出',
            tool: 'format_output',
            params: {},
          },
        ],
      },

      // 分析数据
      analyze_data: {
        name: '分析数据',
        steps: [
          {
            name: '读取数据文件',
            tool: 'data_reader',
            params: {},
          },
          {
            name: '数据分析',
            tool: 'data_analyzer',
            params: {},
          },
          {
            name: '生成可视化图表',
            tool: 'chart_generator',
            params: {},
          },
          {
            name: '生成分析报告',
            tool: 'report_generator',
            params: {},
          },
        ],
      },

      // 导出文件
      export_file: {
        name: '导出文件',
        steps: [
          {
            name: '准备导出数据',
            tool: 'export_preparer',
            params: {},
          },
          {
            name: '执行导出',
            tool: 'file_exporter',
            params: {},
          },
        ],
      },

      // 部署项目
      deploy_project: {
        name: '部署项目',
        steps: [
          {
            name: '运行测试',
            tool: 'run_tests',
            params: {},
          },
          {
            name: '构建项目',
            tool: 'build_project',
            params: {},
          },
          {
            name: '部署到服务器',
            tool: 'deploy_to_server',
            params: {},
          },
        ],
      },
    };
  }

  /**
   * 生成执行计划
   * @param {Object} intent - 意图识别结果
   * @param {Object} context - 上下文信息
   * @returns {Promise<Object>} 执行计划
   */
  async plan(intent, context = {}) {
    console.log(`[Task Planner] 开始规划任务，意图: ${intent.intent}`);

    // 1. 选择合适的模板
    const template = this.selectTemplate(intent, context);

    if (template) {
      console.log(`[Task Planner] 使用模板: ${template.name}`);

      // 2. 根据实体信息填充参数
      const plan = this.fillTemplateParams(template, intent, context);

      return plan;
    } else {
      // 3. 如果没有合适的模板，动态生成计划
      console.log(`[Task Planner] 动态生成计划`);

      return this.generateDynamicPlan(intent, context);
    }
  }

  /**
   * 选择合适的模板
   * @private
   */
  selectTemplate(intent, context) {
    const intentType = intent.intent;
    const entities = intent.entities || {};

    // 根据意图类型和实体选择模板
    if (intentType === 'create_file') {
      const fileType = entities.fileType;

      if (fileType === 'HTML' || fileType === 'CSS' || fileType === 'JavaScript') {
        return this.templates.create_html;
      } else if (fileType === 'Word' || fileType === 'PDF' || fileType === 'Markdown') {
        return this.templates.create_document;
      }

      // 默认使用HTML模板
      return this.templates.create_html;
    } else if (intentType === 'edit_file') {
      return this.templates.edit_file;
    } else if (intentType === 'query_info') {
      return this.templates.query_info;
    } else if (intentType === 'analyze_data') {
      return this.templates.analyze_data;
    } else if (intentType === 'export_file') {
      return this.templates.export_file;
    } else if (intentType === 'deploy_project') {
      return this.templates.deploy_project;
    }

    return null;
  }

  /**
   * 填充模板参数
   * @private
   */
  fillTemplateParams(template, intent, context) {
    const entities = intent.entities || {};
    const steps = [];

    for (const templateStep of template.steps) {
      const step = {
        ...templateStep,
        params: { ...templateStep.params },
      };

      // 根据不同的工具类型填充参数
      if (step.tool === 'html_generator') {
        // 提取主题、内容描述等
        step.params.content = intent.originalInput;
        step.params.title = this.extractTitle(intent.originalInput);

        // 如果有颜色实体，添加到样式参数
        if (entities.colors && entities.colors.length > 0) {
          step.params.primaryColor = entities.colors[0];
        }
      } else if (step.tool === 'css_generator') {
        // CSS生成参数
        if (entities.colors) {
          step.params.colors = entities.colors;
        }
      } else if (step.tool === 'file_editor') {
        // 文件编辑参数
        step.params.filePath = context.currentFile?.file_path;
        step.params.modifications = this.extractModifications(intent, entities);
      } else if (step.tool === 'file_reader') {
        // 文件读取参数
        step.params.filePath = context.currentFile?.file_path;
      } else if (step.tool === 'file_writer') {
        // 文件写入参数
        step.params.filePath = context.currentFile?.file_path;
      } else if (step.tool === 'create_project_structure') {
        // 项目结构创建参数
        step.params.projectName = this.extractProjectName(intent.originalInput);
        step.params.projectPath = context.projectPath || `/data/projects/${Date.now()}`;
      } else if (step.tool === 'git_commit') {
        // Git提交参数
        step.params.message = `Edit: ${intent.originalInput}`;
        step.params.repoPath = context.projectPath;
      } else if (step.tool === 'info_searcher') {
        // 信息搜索参数
        step.params.query = intent.originalInput;
        step.params.projectId = context.projectId;
      }

      steps.push(step);
    }

    return {
      name: template.name,
      steps,
      intent: intent.intent,
      confidence: intent.confidence,
    };
  }

  /**
   * 动态生成计划
   * @private
   */
  generateDynamicPlan(intent, context) {
    // 简单的动态规划逻辑
    const steps = [
      {
        name: '执行用户请求',
        tool: 'generic_handler',
        params: {
          intent: intent.intent,
          input: intent.originalInput,
          entities: intent.entities,
        },
      },
    ];

    return {
      name: '动态任务',
      steps,
      intent: intent.intent,
      confidence: intent.confidence,
    };
  }

  /**
   * 提取标题
   * @private
   */
  extractTitle(text) {
    // 简单的标题提取逻辑
    const match = text.match(/(创建|做|生成)(一个|个)?(.+?)(页面|网站|网页|文档|报告)/);

    if (match) {
      return match[3].trim();
    }

    return '我的项目';
  }

  /**
   * 提取项目名称
   * @private
   */
  extractProjectName(text) {
    const title = this.extractTitle(text);
    // 移除特殊字符，生成合法的文件夹名称
    return title
      .replace(/[^\w\u4e00-\u9fa5]/g, '_')
      .replace(/_+/g, '_')
      .toLowerCase();
  }

  /**
   * 提取修改操作
   * @private
   */
  extractModifications(intent, entities) {
    const modifications = [];

    // 如果有目标和动作，生成修改指令
    if (entities.targets && entities.actions) {
      for (const target of entities.targets) {
        for (const action of entities.actions) {
          modifications.push({
            target,
            action,
            value: entities.colors?.[0] || entities.numbers?.[0],
          });
        }
      }
    }

    // 如果没有结构化的修改，使用原始输入作为描述
    if (modifications.length === 0) {
      modifications.push({
        type: 'general',
        description: intent.originalInput,
      });
    }

    return modifications;
  }

  /**
   * 添加自定义模板
   * @param {string} name - 模板名称
   * @param {Object} template - 模板定义
   */
  addTemplate(name, template) {
    this.templates[name] = template;
  }

  /**
   * 获取所有模板
   * @returns {Object} 模板字典
   */
  getTemplates() {
    return this.templates;
  }
}

module.exports = TaskPlanner;
