/**
 * 内置技能定义
 * 定义系统内置的15个核心技能
 */

module.exports = [
  // 1. 代码开发
  {
    id: 'skill_code_development',
    name: '代码开发',
    display_name: 'Code Development',
    description: '提供完整的代码开发能力，包括文件读写、代码生成和版本控制',
    category: 'code',
    icon: 'code',
    tags: ['代码', '开发', 'Git'],
    config: {
      defaultLanguage: 'javascript',
      autoFormat: true,
      enableLinting: false,
    },
    doc_path: 'docs/skills/code-development.md',
    tools: [
      'file_reader',
      'file_writer',
      'file_editor',
      'create_project_structure',
      'git_init',
      'git_commit',
    ],
  },

  // 2. Web开发
  {
    id: 'skill_web_development',
    name: 'Web开发',
    display_name: 'Web Development',
    description: '创建网页、博客、单页应用等Web项目',
    category: 'web',
    icon: 'global',
    tags: ['Web', 'HTML', 'CSS', 'JavaScript'],
    config: {
      defaultTemplate: 'blog',
      responsive: true,
    },
    doc_path: 'docs/skills/web-development.md',
    tools: [
      'html_generator',
      'css_generator',
      'js_generator',
      'file_writer',
    ],
  },

  // 3. 数据分析
  {
    id: 'skill_data_analysis',
    name: '数据分析',
    display_name: 'Data Analysis',
    description: '读取CSV/Excel、数据清洗和可视化',
    category: 'data',
    icon: 'bar-chart',
    tags: ['数据', '分析', '可视化'],
    config: {
      chartType: 'auto',
      exportFormat: 'png',
    },
    doc_path: 'docs/skills/data-analysis.md',
    tools: [
      'file_reader',
      // 'data_analyzer', // TODO: 需要实现
      // 'chart_generator', // TODO: 需要实现
    ],
  },

  // 4. 内容创作
  {
    id: 'skill_content_creation',
    name: '内容创作',
    display_name: 'Content Creation',
    description: '写文章、文档编辑、Markdown处理',
    category: 'content',
    icon: 'edit',
    tags: ['写作', 'Markdown', '文档'],
    config: {
      defaultFormat: 'markdown',
    },
    doc_path: 'docs/skills/content-creation.md',
    tools: [
      'file_reader',
      'file_writer',
      'format_output',
    ],
  },

  // 5. 文档处理
  {
    id: 'skill_document_processing',
    name: '文档处理',
    display_name: 'Document Processing',
    description: 'Word/PDF/Excel/PPT生成和编辑',
    category: 'document',
    icon: 'file-text',
    tags: ['文档', 'Office', 'PDF'],
    config: {
      defaultFormat: 'docx',
    },
    doc_path: 'docs/skills/document-processing.md',
    tools: [
      'file_reader',
      'file_writer',
    ],
  },

  // 6. 图像处理
  {
    id: 'skill_image_processing',
    name: '图像处理',
    display_name: 'Image Processing',
    description: '图片压缩、格式转换、OCR等',
    category: 'media',
    icon: 'picture',
    tags: ['图片', '图像', 'OCR'],
    config: {
      quality: 80,
      maxWidth: 1920,
    },
    doc_path: 'docs/skills/image-processing.md',
    tools: [
      // 'image_resize', // TODO: 需要实现
      // 'image_convert', // TODO: 需要实现
    ],
  },

  // 7. 视频处理
  {
    id: 'skill_video_processing',
    name: '视频处理',
    display_name: 'Video Processing',
    description: '视频剪辑、合并、格式转换',
    category: 'media',
    icon: 'video-camera',
    tags: ['视频', '剪辑'],
    config: {
      format: 'mp4',
      quality: 'high',
    },
    doc_path: 'docs/skills/video-processing.md',
    tools: [
      // 'video_clip', // TODO: 需要实现
      // 'video_merge', // TODO: 需要实现
    ],
  },

  // 8. 代码执行
  {
    id: 'skill_code_execution',
    name: '代码执行',
    display_name: 'Code Execution',
    description: 'Python、Bash等代码执行和调试',
    category: 'code',
    icon: 'thunderbolt',
    tags: ['执行', 'Python', 'Bash'],
    config: {
      timeout: 30000,
      sandbox: true,
    },
    doc_path: 'docs/skills/code-execution.md',
    tools: [
      // 'python_executor', // TODO: 需要实现
      // 'bash_executor', // TODO: 需要实现
    ],
  },

  // 9. 项目管理
  {
    id: 'skill_project_management',
    name: '项目管理',
    display_name: 'Project Management',
    description: '创建项目结构、Git版本控制',
    category: 'project',
    icon: 'project',
    tags: ['项目', 'Git', '管理'],
    config: {
      autoGit: true,
    },
    doc_path: 'docs/skills/project-management.md',
    tools: [
      'create_project_structure',
      'git_init',
      'git_commit',
      'info_searcher',
    ],
  },

  // 10. 知识库搜索
  {
    id: 'skill_knowledge_search',
    name: '知识库搜索',
    display_name: 'Knowledge Search',
    description: '知识库查询和RAG语义搜索',
    category: 'ai',
    icon: 'search',
    tags: ['知识库', 'RAG', '搜索'],
    config: {
      topK: 5,
      threshold: 0.7,
    },
    doc_path: 'docs/skills/knowledge-search.md',
    tools: [
      // 'knowledge_base_query', // TODO: 需要实现
      // 'rag_search', // TODO: 需要实现
    ],
  },

  // 11. 模板应用
  {
    id: 'skill_template_application',
    name: '模板应用',
    display_name: 'Template Application',
    description: '使用模板创建项目和内容',
    category: 'template',
    icon: 'layout',
    tags: ['模板', '快速创建'],
    config: {
      defaultCategory: 'writing',
    },
    doc_path: 'docs/skills/template-application.md',
    tools: [
      // 'template_fill', // TODO: 需要实现
      // 'project_from_template', // TODO: 需要实现
    ],
  },

  // 12. 系统操作
  {
    id: 'skill_system_operations',
    name: '系统操作',
    display_name: 'System Operations',
    description: '文件系统操作和通用处理',
    category: 'system',
    icon: 'setting',
    tags: ['系统', '文件'],
    config: {},
    doc_path: 'docs/skills/system-operations.md',
    tools: [
      'file_reader',
      'file_writer',
      'generic_handler',
    ],
  },

  // 13. 网络请求
  {
    id: 'skill_network_requests',
    name: '网络请求',
    display_name: 'Network Requests',
    description: 'HTTP请求、API调用、网页抓取',
    category: 'network',
    icon: 'api',
    tags: ['网络', 'HTTP', 'API'],
    config: {
      timeout: 10000,
      retry: 3,
    },
    doc_path: 'docs/skills/network-requests.md',
    tools: [
      // 'http_get', // TODO: 需要实现
      // 'http_post', // TODO: 需要实现
      // 'web_scrape', // TODO: 需要实现
    ],
  },

  // 14. AI对话
  {
    id: 'skill_ai_conversation',
    name: 'AI对话',
    display_name: 'AI Conversation',
    description: 'LLM查询、Prompt模板填充',
    category: 'ai',
    icon: 'robot',
    tags: ['AI', 'LLM', '对话'],
    config: {
      temperature: 0.7,
      maxTokens: 2000,
    },
    doc_path: 'docs/skills/ai-conversation.md',
    tools: [
      // 'llm_query', // TODO: 需要实现
      // 'prompt_template_fill', // TODO: 需要实现
    ],
  },

  // 15. 自动化工作流
  {
    id: 'skill_automation_workflow',
    name: '自动化工作流',
    display_name: 'Automation Workflow',
    description: '任务链执行和条件判断',
    category: 'automation',
    icon: 'branches',
    tags: ['自动化', '工作流'],
    config: {
      maxSteps: 50,
      errorHandling: 'continue',
    },
    doc_path: 'docs/skills/automation-workflow.md',
    tools: [
      // 'task_chain', // TODO: 需要实现
      // 'conditional_execute', // TODO: 需要实现
    ],
  },
];
