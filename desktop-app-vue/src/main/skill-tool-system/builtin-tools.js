/**
 * 内置工具定义
 * 定义所有系统内置工具的元数据
 *
 * 这些工具的handler实际实现在 FunctionCaller 中
 * 这个文件只提供元数据信息,用于注册到ToolManager
 */

module.exports = [
  // 1. 文件读取工具
  {
    id: 'tool_file_reader',
    name: 'file_reader',
    display_name: '文件读取',
    description: '读取指定路径的文件内容',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要读取的文件路径'
        }
      },
      required: ['filePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        content: { type: 'string' }
      }
    },
    examples: [
      {
        description: '读取README文件',
        params: { filePath: './README.md' }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 2. 文件写入工具
  {
    id: 'tool_file_writer',
    name: 'file_writer',
    display_name: '文件写入',
    description: '将内容写入到指定路径的文件',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径'
        },
        content: {
          type: 'string',
          description: '要写入的内容'
        }
      },
      required: ['filePath', 'content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        size: { type: 'number' }
      }
    },
    examples: [
      {
        description: '创建新文件',
        params: {
          filePath: './output.txt',
          content: 'Hello World'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 3. HTML生成工具
  {
    id: 'tool_html_generator',
    name: 'html_generator',
    display_name: 'HTML生成器',
    description: '生成标准HTML页面结构',
    category: 'web',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '页面标题',
          default: '我的网页'
        },
        content: {
          type: 'string',
          description: '页面内容'
        },
        primaryColor: {
          type: 'string',
          description: '主题颜色',
          default: '#667eea'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        html: { type: 'string' },
        fileName: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成简单网页',
        params: {
          title: '我的博客',
          content: '欢迎来到我的博客'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 4. CSS生成工具
  {
    id: 'tool_css_generator',
    name: 'css_generator',
    display_name: 'CSS生成器',
    description: '生成CSS样式文件',
    category: 'web',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        primaryColor: {
          type: 'string',
          description: '主题颜色',
          default: '#667eea'
        },
        fontSize: {
          type: 'string',
          description: '基础字体大小',
          default: '16px'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        css: { type: 'string' },
        fileName: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成样式文件',
        params: {
          primaryColor: '#3498db',
          fontSize: '14px'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 5. JavaScript生成工具
  {
    id: 'tool_js_generator',
    name: 'js_generator',
    display_name: 'JS生成器',
    description: '生成JavaScript文件',
    category: 'web',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        features: {
          type: 'array',
          items: { type: 'string' },
          description: '需要的功能列表'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        js: { type: 'string' },
        fileName: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成基本JS文件',
        params: {
          features: ['dom-ready', 'event-listeners']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 6. 项目结构创建工具
  {
    id: 'tool_create_project_structure',
    name: 'create_project_structure',
    display_name: '项目结构创建',
    description: '创建标准项目目录结构',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称'
        },
        projectType: {
          type: 'string',
          description: '项目类型',
          enum: ['web', 'blog', 'simple']
        },
        outputPath: {
          type: 'string',
          description: '输出路径'
        }
      },
      required: ['projectName', 'projectType', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        projectPath: { type: 'string' },
        createdFiles: { type: 'array' }
      }
    },
    examples: [
      {
        description: '创建博客项目',
        params: {
          projectName: 'my-blog',
          projectType: 'blog',
          outputPath: './projects'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 7. Git初始化工具
  {
    id: 'tool_git_init',
    name: 'git_init',
    display_name: 'Git初始化',
    description: '初始化Git仓库',
    category: 'version-control',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        repoPath: {
          type: 'string',
          description: '仓库路径'
        },
        initialBranch: {
          type: 'string',
          description: '初始分支名',
          default: 'main'
        }
      },
      required: ['repoPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        repoPath: { type: 'string' },
        branch: { type: 'string' }
      }
    },
    examples: [
      {
        description: '初始化仓库',
        params: {
          repoPath: './my-project'
        }
      }
    ],
    required_permissions: ['file:write', 'git:init'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 8. Git提交工具
  {
    id: 'tool_git_commit',
    name: 'git_commit',
    display_name: 'Git提交',
    description: '提交Git更改',
    category: 'version-control',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        repoPath: {
          type: 'string',
          description: '仓库路径'
        },
        message: {
          type: 'string',
          description: '提交信息'
        }
      },
      required: ['repoPath', 'message']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        commitHash: { type: 'string' },
        message: { type: 'string' }
      }
    },
    examples: [
      {
        description: '提交更改',
        params: {
          repoPath: './my-project',
          message: 'Initial commit'
        }
      }
    ],
    required_permissions: ['file:write', 'git:commit'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 9. 信息搜索工具
  {
    id: 'tool_info_searcher',
    name: 'info_searcher',
    display_name: '信息搜索',
    description: '在知识库中搜索相关信息',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询'
        },
        context: {
          type: 'object',
          description: '上下文信息'
        }
      },
      required: ['query']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: { type: 'array' }
      }
    },
    examples: [
      {
        description: '搜索信息',
        params: {
          query: 'JavaScript异步编程'
        }
      }
    ],
    required_permissions: ['database:read', 'ai:search'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 10. 文件编辑工具
  {
    id: 'tool_file_editor',
    name: 'file_editor',
    display_name: '文件编辑',
    description: '编辑现有文件内容',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径'
        },
        operations: {
          type: 'array',
          description: '编辑操作列表',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['replace', 'insert', 'delete'] },
              search: { type: 'string' },
              replacement: { type: 'string' },
              line: { type: 'number' }
            }
          }
        }
      },
      required: ['filePath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        changes: { type: 'number' }
      }
    },
    examples: [
      {
        description: '替换文本',
        params: {
          filePath: './config.js',
          operations: [{
            type: 'replace',
            search: 'oldValue',
            replacement: 'newValue'
          }]
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 11. 格式化输出工具
  {
    id: 'tool_format_output',
    name: 'format_output',
    display_name: '格式化输出',
    description: '格式化输出内容为指定格式',
    category: 'format',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要格式化的内容'
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['json', 'markdown', 'html', 'plain']
        },
        options: {
          type: 'object',
          description: '格式化选项'
        }
      },
      required: ['content', 'format']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formatted: { type: 'string' },
        format: { type: 'string' }
      }
    },
    examples: [
      {
        description: '格式化为Markdown',
        params: {
          content: '这是一段文本',
          format: 'markdown'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 12. 通用处理器
  {
    id: 'tool_generic_handler',
    name: 'generic_handler',
    display_name: '通用处理器',
    description: '处理通用任务的默认处理器',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '要执行的操作'
        },
        params: {
          type: 'object',
          description: '操作参数'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' }
      }
    },
    examples: [
      {
        description: '执行通用操作',
        params: {
          action: 'process',
          params: {}
        }
      }
    ],
    required_permissions: ['system:execute'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
];
