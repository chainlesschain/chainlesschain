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

  // === 新增工具 (13-32) ===

  // 13. JSON解析器
  {
    id: 'tool_json_parser',
    name: 'json_parser',
    display_name: 'JSON解析器',
    description: '解析、验证和格式化JSON数据',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        json: {
          type: 'string',
          description: 'JSON字符串'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'validate', 'format', 'minify']
        },
        indent: {
          type: 'number',
          description: '格式化时的缩进空格数',
          default: 2
        }
      },
      required: ['json', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '格式化JSON',
        params: {
          json: '{"name":"test","value":123}',
          action: 'format',
          indent: 2
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 14. YAML解析器
  {
    id: 'tool_yaml_parser',
    name: 'yaml_parser',
    display_name: 'YAML解析器',
    description: '解析和生成YAML格式数据',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'YAML内容或JSON对象字符串'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'stringify']
        }
      },
      required: ['content', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '解析YAML',
        params: {
          content: 'name: test\nvalue: 123',
          action: 'parse'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 15. 文本分析器
  {
    id: 'tool_text_analyzer',
    name: 'text_analyzer',
    display_name: '文本分析器',
    description: '统计文本字数、词频、句子数等',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要分析的文本'
        },
        options: {
          type: 'object',
          description: '分析选项',
          properties: {
            wordFrequency: { type: 'boolean', default: true },
            sentiment: { type: 'boolean', default: false },
            keywords: { type: 'boolean', default: false }
          }
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        stats: {
          type: 'object',
          properties: {
            charCount: { type: 'number' },
            wordCount: { type: 'number' },
            sentenceCount: { type: 'number' },
            lineCount: { type: 'number' }
          }
        },
        wordFrequency: { type: 'object' },
        keywords: { type: 'array' }
      }
    },
    examples: [
      {
        description: '分析文章',
        params: {
          text: '这是一段测试文本。用于分析统计。',
          options: { wordFrequency: true }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 16. 日期时间处理器
  {
    id: 'tool_datetime_handler',
    name: 'datetime_handler',
    display_name: '日期时间处理器',
    description: '格式化、解析和计算日期时间',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['format', 'parse', 'add', 'subtract', 'diff']
        },
        date: {
          type: 'string',
          description: '日期字符串或时间戳'
        },
        format: {
          type: 'string',
          description: '日期格式',
          default: 'YYYY-MM-DD HH:mm:ss'
        },
        amount: {
          type: 'number',
          description: '添加/减少的数量'
        },
        unit: {
          type: 'string',
          description: '时间单位',
          enum: ['year', 'month', 'day', 'hour', 'minute', 'second']
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
        timestamp: { type: 'number' }
      }
    },
    examples: [
      {
        description: '格式化当前时间',
        params: {
          action: 'format',
          format: 'YYYY年MM月DD日'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 17. URL处理器
  {
    id: 'tool_url_parser',
    name: 'url_parser',
    display_name: 'URL处理器',
    description: '解析、构建和验证URL',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL字符串'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'build', 'validate', 'encode', 'decode']
        },
        params: {
          type: 'object',
          description: '查询参数（用于build）'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        valid: { type: 'boolean' }
      }
    },
    examples: [
      {
        description: '解析URL',
        params: {
          url: 'https://example.com/path?key=value',
          action: 'parse'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 18. 加密解密工具
  {
    id: 'tool_crypto_handler',
    name: 'crypto_handler',
    display_name: '加密解密工具',
    description: '提供AES、RSA、MD5、SHA等加密解密功能',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['encrypt', 'decrypt', 'hash', 'verify']
        },
        algorithm: {
          type: 'string',
          description: '算法',
          enum: ['aes-256-cbc', 'md5', 'sha256', 'sha512']
        },
        data: {
          type: 'string',
          description: '要处理的数据'
        },
        key: {
          type: 'string',
          description: '加密密钥（用于加密/解密）'
        },
        iv: {
          type: 'string',
          description: '初始化向量（用于AES）'
        }
      },
      required: ['action', 'algorithm', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
        algorithm: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'SHA256哈希',
        params: {
          action: 'hash',
          algorithm: 'sha256',
          data: 'Hello World'
        }
      }
    ],
    required_permissions: ['crypto:execute'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 19. Base64编解码
  {
    id: 'tool_base64_handler',
    name: 'base64_handler',
    display_name: 'Base64编解码',
    description: 'Base64编码和解码',
    category: 'encoding',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['encode', 'decode']
        },
        data: {
          type: 'string',
          description: '要处理的数据'
        },
        encoding: {
          type: 'string',
          description: '字符编码',
          default: 'utf8',
          enum: ['utf8', 'ascii', 'binary']
        }
      },
      required: ['action', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'Base64编码',
        params: {
          action: 'encode',
          data: 'Hello World'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 20. HTTP客户端
  {
    id: 'tool_http_client',
    name: 'http_client',
    display_name: 'HTTP客户端',
    description: '发送HTTP/HTTPS请求',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '请求URL'
        },
        method: {
          type: 'string',
          description: 'HTTP方法',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          default: 'GET'
        },
        headers: {
          type: 'object',
          description: '请求头'
        },
        body: {
          type: 'any',
          description: '请求体'
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒）',
          default: 10000
        }
      },
      required: ['url']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        status: { type: 'number' },
        headers: { type: 'object' },
        data: { type: 'any' }
      }
    },
    examples: [
      {
        description: 'GET请求',
        params: {
          url: 'https://api.example.com/data',
          method: 'GET'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 21. 正则表达式测试器
  {
    id: 'tool_regex_tester',
    name: 'regex_tester',
    display_name: '正则表达式测试器',
    description: '测试、匹配和替换正则表达式',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '正则表达式模式'
        },
        text: {
          type: 'string',
          description: '要测试的文本'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['test', 'match', 'replace', 'split'],
          default: 'test'
        },
        replacement: {
          type: 'string',
          description: '替换文本（用于replace）'
        },
        flags: {
          type: 'string',
          description: '正则标志（g, i, m等）',
          default: 'g'
        }
      },
      required: ['pattern', 'text', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        matches: { type: 'array' }
      }
    },
    examples: [
      {
        description: '测试邮箱格式',
        params: {
          pattern: '^[\\w-\\.]+@([\\w-]+\\.)+[\\w-]{2,4}$',
          text: 'test@example.com',
          action: 'test'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 22. Markdown转换器
  {
    id: 'tool_markdown_converter',
    name: 'markdown_converter',
    display_name: 'Markdown转换器',
    description: '将Markdown转换为HTML或其他格式',
    category: 'format',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description: 'Markdown内容'
        },
        targetFormat: {
          type: 'string',
          description: '目标格式',
          enum: ['html', 'plain', 'pdf'],
          default: 'html'
        },
        options: {
          type: 'object',
          description: '转换选项',
          properties: {
            sanitize: { type: 'boolean', default: true },
            breaks: { type: 'boolean', default: true },
            tables: { type: 'boolean', default: true }
          }
        }
      },
      required: ['markdown']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
        format: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'Markdown转HTML',
        params: {
          markdown: '# 标题\n\n这是一段**粗体**文本。',
          targetFormat: 'html'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 23. CSV处理器
  {
    id: 'tool_csv_handler',
    name: 'csv_handler',
    display_name: 'CSV处理器',
    description: '解析、生成和操作CSV数据',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'stringify', 'filter', 'sort'],
          default: 'parse'
        },
        data: {
          type: 'string',
          description: 'CSV字符串或JSON数组字符串'
        },
        options: {
          type: 'object',
          description: 'CSV选项',
          properties: {
            delimiter: { type: 'string', default: ',' },
            header: { type: 'boolean', default: true },
            quote: { type: 'string', default: '"' }
          }
        }
      },
      required: ['action', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        rowCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '解析CSV',
        params: {
          action: 'parse',
          data: 'name,age\nJohn,30\nJane,25'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 24. ZIP压缩工具
  {
    id: 'tool_zip_handler',
    name: 'zip_handler',
    display_name: 'ZIP压缩工具',
    description: '压缩和解压ZIP文件',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['compress', 'extract', 'list'],
          default: 'compress'
        },
        source: {
          type: 'string',
          description: '源文件或目录路径'
        },
        target: {
          type: 'string',
          description: '目标ZIP文件路径'
        },
        password: {
          type: 'string',
          description: '压缩密码（可选）'
        }
      },
      required: ['action', 'source']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        zipPath: { type: 'string' },
        files: { type: 'array' },
        size: { type: 'number' }
      }
    },
    examples: [
      {
        description: '压缩文件夹',
        params: {
          action: 'compress',
          source: './my-folder',
          target: './archive.zip'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 25. Excel读取器
  {
    id: 'tool_excel_reader',
    name: 'excel_reader',
    display_name: 'Excel读取器',
    description: '读取和解析Excel文件（.xlsx, .xls）',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Excel文件路径'
        },
        sheetName: {
          type: 'string',
          description: '工作表名称（留空读取第一个）'
        },
        range: {
          type: 'string',
          description: '读取范围（如 A1:C10）'
        },
        header: {
          type: 'boolean',
          description: '是否包含表头',
          default: true
        }
      },
      required: ['filePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'array' },
        sheets: { type: 'array' },
        rowCount: { type: 'number' }
      }
    },
    examples: [
      {
        description: '读取Excel文件',
        params: {
          filePath: './data.xlsx',
          sheetName: 'Sheet1'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 26. SQL查询构建器
  {
    id: 'tool_sql_builder',
    name: 'sql_builder',
    display_name: 'SQL查询构建器',
    description: '构建和验证SQL查询语句',
    category: 'database',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['select', 'insert', 'update', 'delete', 'validate'],
          default: 'select'
        },
        table: {
          type: 'string',
          description: '表名'
        },
        fields: {
          type: 'array',
          description: '字段列表',
          items: { type: 'string' }
        },
        where: {
          type: 'object',
          description: 'WHERE条件'
        },
        values: {
          type: 'object',
          description: '插入/更新的值'
        },
        orderBy: {
          type: 'string',
          description: '排序字段'
        },
        limit: {
          type: 'number',
          description: '返回记录数'
        }
      },
      required: ['action', 'table']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        sql: { type: 'string' },
        params: { type: 'array' }
      }
    },
    examples: [
      {
        description: '构建SELECT查询',
        params: {
          action: 'select',
          table: 'users',
          fields: ['id', 'name', 'email'],
          where: { status: 'active' },
          limit: 10
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 27. 图片元数据提取器
  {
    id: 'tool_image_metadata',
    name: 'image_metadata',
    display_name: '图片元数据提取器',
    description: '提取图片的EXIF、尺寸等元数据',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '图片文件路径'
        },
        extractEXIF: {
          type: 'boolean',
          description: '是否提取EXIF数据',
          default: true
        }
      },
      required: ['imagePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        width: { type: 'number' },
        height: { type: 'number' },
        format: { type: 'string' },
        size: { type: 'number' },
        exif: { type: 'object' }
      }
    },
    examples: [
      {
        description: '提取图片信息',
        params: {
          imagePath: './photo.jpg',
          extractEXIF: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 28. 环境变量管理器
  {
    id: 'tool_env_manager',
    name: 'env_manager',
    display_name: '环境变量管理器',
    description: '读取、解析和管理.env文件',
    category: 'config',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['read', 'parse', 'set', 'delete', 'list'],
          default: 'read'
        },
        envPath: {
          type: 'string',
          description: '.env文件路径',
          default: '.env'
        },
        key: {
          type: 'string',
          description: '环境变量键名'
        },
        value: {
          type: 'string',
          description: '环境变量值'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        variables: { type: 'object' },
        count: { type: 'number' }
      }
    },
    examples: [
      {
        description: '读取环境变量',
        params: {
          action: 'read',
          envPath: '.env'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 29. 颜色转换器
  {
    id: 'tool_color_converter',
    name: 'color_converter',
    display_name: '颜色转换器',
    description: '转换颜色格式（HEX, RGB, HSL等）',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: '颜色值'
        },
        from: {
          type: 'string',
          description: '源格式',
          enum: ['hex', 'rgb', 'hsl', 'hsv']
        },
        to: {
          type: 'string',
          description: '目标格式',
          enum: ['hex', 'rgb', 'hsl', 'hsv', 'all']
        }
      },
      required: ['color', 'from', 'to']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        hex: { type: 'string' },
        rgb: { type: 'object' },
        hsl: { type: 'object' }
      }
    },
    examples: [
      {
        description: '转换颜色格式',
        params: {
          color: '#FF5733',
          from: 'hex',
          to: 'rgb'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 30. 随机数据生成器
  {
    id: 'tool_random_generator',
    name: 'random_generator',
    display_name: '随机数据生成器',
    description: '生成随机数、字符串、UUID等',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '数据类型',
          enum: ['number', 'string', 'uuid', 'boolean', 'date', 'color']
        },
        count: {
          type: 'number',
          description: '生成数量',
          default: 1
        },
        options: {
          type: 'object',
          description: '生成选项',
          properties: {
            min: { type: 'number' },
            max: { type: 'number' },
            length: { type: 'number' },
            charset: { type: 'string' }
          }
        }
      },
      required: ['type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        count: { type: 'number' }
      }
    },
    examples: [
      {
        description: '生成UUID',
        params: {
          type: 'uuid',
          count: 5
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 31. 文件搜索器
  {
    id: 'tool_file_searcher',
    name: 'file_searcher',
    display_name: '文件搜索器',
    description: '在目录中搜索文件和内容',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '搜索路径'
        },
        pattern: {
          type: 'string',
          description: '文件名模式（支持通配符）'
        },
        content: {
          type: 'string',
          description: '搜索内容（可选）'
        },
        recursive: {
          type: 'boolean',
          description: '是否递归搜索',
          default: true
        },
        maxDepth: {
          type: 'number',
          description: '最大搜索深度',
          default: 10
        }
      },
      required: ['path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        files: { type: 'array' },
        count: { type: 'number' }
      }
    },
    examples: [
      {
        description: '搜索JS文件',
        params: {
          path: './src',
          pattern: '*.js',
          recursive: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 32. 模板渲染器
  {
    id: 'tool_template_renderer',
    name: 'template_renderer',
    display_name: '模板渲染器',
    description: '使用变量渲染模板字符串',
    category: 'template',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: '模板字符串'
        },
        variables: {
          type: 'object',
          description: '变量对象'
        },
        syntax: {
          type: 'string',
          description: '模板语法',
          enum: ['mustache', 'handlebars', 'ejs'],
          default: 'mustache'
        }
      },
      required: ['template', 'variables']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' }
      }
    },
    examples: [
      {
        description: '渲染问候模板',
        params: {
          template: 'Hello {{name}}, welcome to {{app}}!',
          variables: { name: 'John', app: 'ChainlessChain' },
          syntax: 'mustache'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // === 第二批新增工具 (33-52) ===

  // 33. QR码生成器
  {
    id: 'tool_qrcode_generator',
    name: 'qrcode_generator',
    display_name: 'QR码生成器',
    description: '生成QR二维码图片',
    category: 'image',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: '要编码的数据（URL、文本等）'
        },
        size: {
          type: 'number',
          description: '二维码尺寸（像素）',
          default: 256
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['png', 'svg', 'dataurl'],
          default: 'png'
        },
        errorLevel: {
          type: 'string',
          description: '错误纠正级别',
          enum: ['L', 'M', 'Q', 'H'],
          default: 'M'
        }
      },
      required: ['data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
        format: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成网站QR码',
        params: {
          data: 'https://example.com',
          size: 256
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 34. Diff比较器
  {
    id: 'tool_diff_comparator',
    name: 'diff_comparator',
    display_name: 'Diff比较器',
    description: '比较两个文本或文件的差异',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text1: {
          type: 'string',
          description: '第一个文本'
        },
        text2: {
          type: 'string',
          description: '第二个文本'
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['unified', 'side-by-side', 'json'],
          default: 'unified'
        },
        ignoreWhitespace: {
          type: 'boolean',
          description: '忽略空白字符',
          default: false
        }
      },
      required: ['text1', 'text2']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        diff: { type: 'string' },
        changes: { type: 'number' },
        additions: { type: 'number' },
        deletions: { type: 'number' }
      }
    },
    examples: [
      {
        description: '比较两段文本',
        params: {
          text1: 'Hello World',
          text2: 'Hello ChainlessChain'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 35. Hash校验器
  {
    id: 'tool_hash_verifier',
    name: 'hash_verifier',
    display_name: 'Hash校验器',
    description: '计算和验证文件/文本的Hash值',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径'
        },
        text: {
          type: 'string',
          description: '文本内容'
        },
        algorithm: {
          type: 'string',
          description: 'Hash算法',
          enum: ['md5', 'sha1', 'sha256', 'sha512'],
          default: 'sha256'
        },
        expectedHash: {
          type: 'string',
          description: '期望的Hash值（用于验证）'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        hash: { type: 'string' },
        algorithm: { type: 'string' },
        verified: { type: 'boolean' }
      }
    },
    examples: [
      {
        description: '计算文件SHA256',
        params: {
          filePath: './file.zip',
          algorithm: 'sha256'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 36. IP地址工具
  {
    id: 'tool_ip_utility',
    name: 'ip_utility',
    display_name: 'IP地址工具',
    description: 'IP地址验证、解析和查询',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['validate', 'parse', 'lookup', 'cidr'],
          default: 'validate'
        },
        ip: {
          type: 'string',
          description: 'IP地址'
        },
        cidr: {
          type: 'string',
          description: 'CIDR表示法'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        isValid: { type: 'boolean' },
        version: { type: 'string' }
      }
    },
    examples: [
      {
        description: '验证IP地址',
        params: {
          action: 'validate',
          ip: '192.168.1.1'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 37. User-Agent解析器
  {
    id: 'tool_useragent_parser',
    name: 'useragent_parser',
    display_name: 'User-Agent解析器',
    description: '解析User-Agent字符串',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        userAgent: {
          type: 'string',
          description: 'User-Agent字符串'
        }
      },
      required: ['userAgent']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        browser: { type: 'object' },
        os: { type: 'object' },
        device: { type: 'object' }
      }
    },
    examples: [
      {
        description: '解析浏览器UA',
        params: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 38. Cron表达式解析器
  {
    id: 'tool_cron_parser',
    name: 'cron_parser',
    display_name: 'Cron表达式解析器',
    description: '解析和生成Cron表达式',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'generate', 'next'],
          default: 'parse'
        },
        expression: {
          type: 'string',
          description: 'Cron表达式'
        },
        description: {
          type: 'string',
          description: '时间描述（用于生成）'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        description: { type: 'string' },
        nextRun: { type: 'string' }
      }
    },
    examples: [
      {
        description: '解析Cron表达式',
        params: {
          action: 'parse',
          expression: '0 0 * * *'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 39. 代码美化器
  {
    id: 'tool_code_formatter',
    name: 'code_formatter',
    display_name: '代码美化器',
    description: '格式化各种编程语言的代码',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '要格式化的代码'
        },
        language: {
          type: 'string',
          description: '编程语言',
          enum: ['javascript', 'json', 'html', 'css', 'sql', 'python'],
          default: 'javascript'
        },
        options: {
          type: 'object',
          description: '格式化选项',
          properties: {
            indent: { type: 'number', default: 2 },
            semicolons: { type: 'boolean', default: true }
          }
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formatted: { type: 'string' },
        language: { type: 'string' }
      }
    },
    examples: [
      {
        description: '格式化JavaScript代码',
        params: {
          code: 'function test(){return 42}',
          language: 'javascript'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 40. 文本编码检测器
  {
    id: 'tool_encoding_detector',
    name: 'encoding_detector',
    display_name: '文本编码检测器',
    description: '检测文本或文件的字符编码',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '文件路径'
        },
        buffer: {
          type: 'string',
          description: 'Buffer数据（base64）'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        encoding: { type: 'string' },
        confidence: { type: 'number' }
      }
    },
    examples: [
      {
        description: '检测文件编码',
        params: {
          filePath: './document.txt'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 41. 版本号比较器
  {
    id: 'tool_version_comparator',
    name: 'version_comparator',
    display_name: '版本号比较器',
    description: 'Semver版本号比较和验证',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['compare', 'validate', 'bump', 'parse'],
          default: 'compare'
        },
        version1: {
          type: 'string',
          description: '第一个版本号'
        },
        version2: {
          type: 'string',
          description: '第二个版本号'
        },
        bumpType: {
          type: 'string',
          description: '升级类型',
          enum: ['major', 'minor', 'patch']
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        comparison: { type: 'number' }
      }
    },
    examples: [
      {
        description: '比较版本号',
        params: {
          action: 'compare',
          version1: '1.2.3',
          version2: '1.2.4'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 42. JWT解析器
  {
    id: 'tool_jwt_parser',
    name: 'jwt_parser',
    display_name: 'JWT解析器',
    description: '解析和验证JWT令牌',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'JWT令牌'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['decode', 'verify'],
          default: 'decode'
        },
        secret: {
          type: 'string',
          description: '密钥（用于验证）'
        }
      },
      required: ['token']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        header: { type: 'object' },
        payload: { type: 'object' },
        signature: { type: 'string' },
        verified: { type: 'boolean' }
      }
    },
    examples: [
      {
        description: '解析JWT令牌',
        params: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          action: 'decode'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 43. XML解析器
  {
    id: 'tool_xml_parser',
    name: 'xml_parser',
    display_name: 'XML解析器',
    description: '解析和生成XML数据',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'stringify', 'validate'],
          default: 'parse'
        },
        xml: {
          type: 'string',
          description: 'XML字符串'
        },
        data: {
          type: 'object',
          description: '要转换为XML的数据'
        },
        options: {
          type: 'object',
          description: '解析选项'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        valid: { type: 'boolean' }
      }
    },
    examples: [
      {
        description: '解析XML',
        params: {
          action: 'parse',
          xml: '<root><item>value</item></root>'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 44. HTML解析器
  {
    id: 'tool_html_parser',
    name: 'html_parser',
    display_name: 'HTML解析器',
    description: '解析HTML并提取内容',
    category: 'web',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'HTML字符串'
        },
        selector: {
          type: 'string',
          description: 'CSS选择器'
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'query', 'extract', 'text'],
          default: 'parse'
        }
      },
      required: ['html', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        elements: { type: 'array' }
      }
    },
    examples: [
      {
        description: '提取HTML文本',
        params: {
          html: '<div><p>Hello</p></div>',
          action: 'text'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 45. TOML解析器
  {
    id: 'tool_toml_parser',
    name: 'toml_parser',
    display_name: 'TOML解析器',
    description: '解析和生成TOML配置文件',
    category: 'config',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'stringify'],
          default: 'parse'
        },
        toml: {
          type: 'string',
          description: 'TOML字符串'
        },
        data: {
          type: 'object',
          description: '要转换为TOML的数据'
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
        description: '解析TOML配置',
        params: {
          action: 'parse',
          toml: '[server]\nport = 8080'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 46. INI解析器
  {
    id: 'tool_ini_parser',
    name: 'ini_parser',
    display_name: 'INI解析器',
    description: '解析和生成INI配置文件',
    category: 'config',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['parse', 'stringify'],
          default: 'parse'
        },
        ini: {
          type: 'string',
          description: 'INI字符串'
        },
        data: {
          type: 'object',
          description: '要转换为INI的数据'
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
        description: '解析INI文件',
        params: {
          action: 'parse',
          ini: '[section]\nkey=value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 47. DNS查询器
  {
    id: 'tool_dns_lookup',
    name: 'dns_lookup',
    display_name: 'DNS查询器',
    description: '查询DNS记录',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: '域名'
        },
        recordType: {
          type: 'string',
          description: '记录类型',
          enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'],
          default: 'A'
        }
      },
      required: ['domain']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        records: { type: 'array' },
        type: { type: 'string' }
      }
    },
    examples: [
      {
        description: '查询A记录',
        params: {
          domain: 'example.com',
          recordType: 'A'
        }
      }
    ],
    required_permissions: ['network:dns'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 48. 端口检测器
  {
    id: 'tool_port_checker',
    name: 'port_checker',
    display_name: '端口检测器',
    description: '检测端口是否开放',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: '主机地址'
        },
        port: {
          type: 'number',
          description: '端口号'
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒）',
          default: 3000
        }
      },
      required: ['host', 'port']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        isOpen: { type: 'boolean' },
        host: { type: 'string' },
        port: { type: 'number' }
      }
    },
    examples: [
      {
        description: '检测端口80',
        params: {
          host: 'example.com',
          port: 80
        }
      }
    ],
    required_permissions: ['network:connect'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 49. 邮件解析器
  {
    id: 'tool_email_parser',
    name: 'email_parser',
    display_name: '邮件解析器',
    description: '解析电子邮件地址和内容',
    category: 'email',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['validate', 'parse', 'extract'],
          default: 'validate'
        },
        email: {
          type: 'string',
          description: '邮件地址'
        },
        content: {
          type: 'string',
          description: '邮件内容'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        isValid: { type: 'boolean' }
      }
    },
    examples: [
      {
        description: '验证邮箱地址',
        params: {
          action: 'validate',
          email: 'user@example.com'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 50. Slug生成器
  {
    id: 'tool_slug_generator',
    name: 'slug_generator',
    display_name: 'Slug生成器',
    description: '生成URL友好的slug字符串',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要转换的文本'
        },
        separator: {
          type: 'string',
          description: '分隔符',
          default: '-'
        },
        lowercase: {
          type: 'boolean',
          description: '是否转小写',
          default: true
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        slug: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成文章slug',
        params: {
          text: 'Hello World - 你好世界!'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 51. Git Diff解析器
  {
    id: 'tool_gitdiff_parser',
    name: 'gitdiff_parser',
    display_name: 'Git Diff解析器',
    description: '解析Git diff输出',
    category: 'version-control',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        diff: {
          type: 'string',
          description: 'Git diff输出'
        }
      },
      required: ['diff']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        files: { type: 'array' },
        additions: { type: 'number' },
        deletions: { type: 'number' }
      }
    },
    examples: [
      {
        description: '解析Git diff',
        params: {
          diff: 'diff --git a/file.js b/file.js...'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 52. 语言检测器
  {
    id: 'tool_language_detector',
    name: 'language_detector',
    display_name: '语言检测器',
    description: '检测文本的自然语言',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要检测的文本'
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        language: { type: 'string' },
        confidence: { type: 'number' },
        alternatives: { type: 'array' }
      }
    },
    examples: [
      {
        description: '检测文本语言',
        params: {
          text: 'Hello World'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // ==================== 第三批扩展工具 (53-72) ====================

  {
    id: 'tool_video_metadata_reader',
    name: 'video_metadata_reader',
    display_name: '视频元数据读取器',
    description: '读取视频文件的元信息（分辨率、时长、编码、帧率等）',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '视频文件路径'
        }
      },
      required: ['filePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        metadata: {
          type: 'object',
          properties: {
            duration: { type: 'number', description: '时长（秒）' },
            width: { type: 'number' },
            height: { type: 'number' },
            codec: { type: 'string' },
            fps: { type: 'number' },
            bitrate: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '读取视频元数据',
        params: {
          filePath: '/path/to/video.mp4'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_audio_duration_calculator',
    name: 'audio_duration_calculator',
    display_name: '音频时长计算器',
    description: '计算音频文件的时长和其他音频属性',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '音频文件路径'
        }
      },
      required: ['filePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        duration: { type: 'number', description: '时长（秒）' },
        format: { type: 'string' },
        sampleRate: { type: 'number' },
        channels: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '计算音频时长',
        params: {
          filePath: '/path/to/audio.mp3'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_subtitle_parser',
    name: 'subtitle_parser',
    display_name: '字幕解析器',
    description: '解析 SRT、VTT、ASS 等字幕格式',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '字幕文件内容或路径'
        },
        format: {
          type: 'string',
          description: '字幕格式',
          enum: ['srt', 'vtt', 'ass', 'auto']
        }
      },
      required: ['content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        subtitles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              start: { type: 'string' },
              end: { type: 'string' },
              text: { type: 'string' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '解析 SRT 字幕',
        params: {
          content: '1\n00:00:00,000 --> 00:00:05,000\nHello World',
          format: 'srt'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_model_predictor',
    name: 'model_predictor',
    display_name: '模型预测器',
    description: '加载机器学习模型并执行推理预测',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelPath: {
          type: 'string',
          description: '模型文件路径'
        },
        input: {
          type: 'any',
          description: '输入数据'
        },
        framework: {
          type: 'string',
          description: '框架类型',
          enum: ['onnx', 'tensorflow', 'pytorch']
        }
      },
      required: ['modelPath', 'input']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        prediction: { type: 'any' },
        confidence: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '图像分类预测',
        params: {
          modelPath: '/models/resnet50.onnx',
          input: [/* image tensor */],
          framework: 'onnx'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_data_aggregator',
    name: 'data_aggregator',
    display_name: '数据聚合器',
    description: '对数据进行分组、聚合、统计计算',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '数据数组'
        },
        groupBy: {
          type: 'string',
          description: '分组字段'
        },
        aggregations: {
          type: 'array',
          description: '聚合操作列表',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              operation: {
                type: 'string',
                enum: ['sum', 'avg', 'min', 'max', 'count']
              }
            }
          }
        }
      },
      required: ['data', 'aggregations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '计算销售数据统计',
        params: {
          data: [{category: 'A', sales: 100}, {category: 'A', sales: 200}],
          groupBy: 'category',
          aggregations: [{field: 'sales', operation: 'sum'}]
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_statistical_calculator',
    name: 'statistical_calculator',
    display_name: '统计计算器',
    description: '计算均值、方差、标准差、百分位数等统计指标',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '数值数组',
          items: { type: 'number' }
        },
        metrics: {
          type: 'array',
          description: '要计算的指标',
          items: {
            type: 'string',
            enum: ['mean', 'median', 'mode', 'variance', 'stddev', 'min', 'max', 'percentile']
          }
        },
        percentile: {
          type: 'number',
          description: '百分位数（0-100）',
          default: 50
        }
      },
      required: ['data', 'metrics']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        statistics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '计算数据集统计信息',
        params: {
          data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          metrics: ['mean', 'median', 'stddev']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_chart_data_generator',
    name: 'chart_data_generator',
    display_name: '图表数据生成器',
    description: '为各种图表（折线图、柱状图、饼图）生成数据格式',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '原始数据'
        },
        chartType: {
          type: 'string',
          description: '图表类型',
          enum: ['line', 'bar', 'pie', 'scatter', 'area']
        },
        xField: {
          type: 'string',
          description: 'X 轴字段'
        },
        yField: {
          type: 'string',
          description: 'Y 轴字段'
        }
      },
      required: ['data', 'chartType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        chartData: { type: 'object' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成折线图数据',
        params: {
          data: [{month: 'Jan', value: 100}, {month: 'Feb', value: 150}],
          chartType: 'line',
          xField: 'month',
          yField: 'value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_template_renderer',
    name: 'template_renderer',
    display_name: '模板渲染器',
    display_name: '模板渲染器',
    description: '使用 Mustache/Handlebars 语法渲染模板',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: '模板字符串'
        },
        data: {
          type: 'object',
          description: '数据对象'
        },
        engine: {
          type: 'string',
          description: '模板引擎',
          enum: ['mustache', 'handlebars', 'ejs'],
          default: 'mustache'
        }
      },
      required: ['template', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        rendered: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '渲染欢迎邮件模板',
        params: {
          template: 'Hello {{name}}, welcome to {{company}}!',
          data: {name: 'John', company: 'Acme Inc'},
          engine: 'mustache'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_api_requester',
    name: 'api_requester',
    display_name: 'API请求器',
    description: '发送 HTTP 请求（GET/POST/PUT/DELETE）并处理响应',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'API URL'
        },
        method: {
          type: 'string',
          description: 'HTTP 方法',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
        },
        headers: {
          type: 'object',
          description: '请求头'
        },
        body: {
          type: 'any',
          description: '请求体'
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒）',
          default: 30000
        }
      },
      required: ['url', 'method']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        status: { type: 'number' },
        data: { type: 'any' },
        headers: { type: 'object' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '获取用户信息',
        params: {
          url: 'https://api.example.com/users/123',
          method: 'GET',
          headers: {'Authorization': 'Bearer token123'}
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_oauth_helper',
    name: 'oauth_helper',
    display_name: 'OAuth助手',
    description: '处理 OAuth 2.0 认证流程',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['authorize', 'token', 'refresh']
        },
        clientId: {
          type: 'string',
          description: '客户端ID'
        },
        clientSecret: {
          type: 'string',
          description: '客户端密钥'
        },
        authorizationUrl: {
          type: 'string',
          description: '授权URL'
        },
        tokenUrl: {
          type: 'string',
          description: '令牌URL'
        },
        refreshToken: {
          type: 'string',
          description: '刷新令牌'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
        expiresIn: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '获取访问令牌',
        params: {
          action: 'token',
          clientId: 'your-client-id',
          clientSecret: 'your-secret',
          tokenUrl: 'https://oauth.example.com/token'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_s3_client',
    name: 's3_client',
    display_name: 'S3客户端',
    description: '与 AWS S3 或兼容服务交互（上传、下载、列表）',
    category: 'storage',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['upload', 'download', 'list', 'delete']
        },
        bucket: {
          type: 'string',
          description: '存储桶名称'
        },
        key: {
          type: 'string',
          description: '对象键'
        },
        localPath: {
          type: 'string',
          description: '本地文件路径'
        },
        credentials: {
          type: 'object',
          description: 'AWS 凭证',
          properties: {
            accessKeyId: { type: 'string' },
            secretAccessKey: { type: 'string' },
            region: { type: 'string' }
          }
        }
      },
      required: ['action', 'bucket']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '上传文件到 S3',
        params: {
          action: 'upload',
          bucket: 'my-bucket',
          key: 'files/document.pdf',
          localPath: '/path/to/document.pdf'
        }
      }
    ],
    required_permissions: ['network:http', 'file:read'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_oss_client',
    name: 'oss_client',
    display_name: '阿里云OSS客户端',
    description: '与阿里云 OSS 交互（上传、下载、管理）',
    category: 'storage',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['upload', 'download', 'list', 'delete']
        },
        bucket: {
          type: 'string',
          description: 'Bucket 名称'
        },
        objectKey: {
          type: 'string',
          description: '对象键'
        },
        localPath: {
          type: 'string',
          description: '本地文件路径'
        },
        credentials: {
          type: 'object',
          description: 'OSS 凭证',
          properties: {
            accessKeyId: { type: 'string' },
            accessKeySecret: { type: 'string' },
            region: { type: 'string' }
          }
        }
      },
      required: ['action', 'bucket']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '上传文件到阿里云 OSS',
        params: {
          action: 'upload',
          bucket: 'my-oss-bucket',
          objectKey: 'images/photo.jpg',
          localPath: '/path/to/photo.jpg'
        }
      }
    ],
    required_permissions: ['network:http', 'file:read'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_log_parser',
    name: 'log_parser',
    display_name: '日志解析器',
    description: '解析 Nginx、Apache、JSON 等格式的日志',
    category: 'devops',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        logContent: {
          type: 'string',
          description: '日志内容'
        },
        format: {
          type: 'string',
          description: '日志格式',
          enum: ['nginx', 'apache', 'json', 'syslog', 'auto']
        },
        filter: {
          type: 'object',
          description: '过滤条件'
        }
      },
      required: ['logContent']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
              level: { type: 'string' },
              message: { type: 'string' },
              metadata: { type: 'object' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '解析 Nginx 访问日志',
        params: {
          logContent: '127.0.0.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200',
          format: 'nginx'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_performance_profiler',
    name: 'performance_profiler',
    display_name: '性能分析器',
    description: '分析代码执行性能，收集性能指标',
    category: 'devops',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['start', 'stop', 'snapshot', 'report']
        },
        target: {
          type: 'string',
          description: '分析目标'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        metrics: {
          type: 'object',
          properties: {
            cpuUsage: { type: 'number' },
            memoryUsage: { type: 'number' },
            executionTime: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '启动性能分析',
        params: {
          action: 'start',
          target: 'main-process'
        }
      }
    ],
    required_permissions: ['system:monitor'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_memory_monitor',
    name: 'memory_monitor',
    display_name: '内存监控器',
    description: '监控内存使用情况，检测内存泄漏',
    category: 'devops',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['snapshot', 'compare', 'heapdump']
        },
        previousSnapshot: {
          type: 'string',
          description: '之前的快照ID'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        snapshot: {
          type: 'object',
          properties: {
            heapUsed: { type: 'number' },
            heapTotal: { type: 'number' },
            external: { type: 'number' },
            rss: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '获取内存快照',
        params: {
          action: 'snapshot'
        }
      }
    ],
    required_permissions: ['system:monitor'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_translator',
    name: 'translator',
    display_name: '翻译器',
    description: '多语言文本翻译（支持主流语言）',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要翻译的文本'
        },
        from: {
          type: 'string',
          description: '源语言',
          default: 'auto'
        },
        to: {
          type: 'string',
          description: '目标语言'
        },
        service: {
          type: 'string',
          description: '翻译服务',
          enum: ['google', 'baidu', 'youdao', 'deepl'],
          default: 'google'
        }
      },
      required: ['text', 'to']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        translated: { type: 'string' },
        detectedLanguage: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '中译英',
        params: {
          text: '你好，世界',
          to: 'en'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_locale_formatter',
    name: 'locale_formatter',
    display_name: '本地化格式化器',
    description: '格式化日期、数字、货币等本地化内容',
    category: 'text',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        value: {
          type: 'any',
          description: '要格式化的值'
        },
        type: {
          type: 'string',
          description: '格式化类型',
          enum: ['date', 'time', 'number', 'currency', 'percent']
        },
        locale: {
          type: 'string',
          description: '本地化标识符',
          default: 'en-US'
        },
        options: {
          type: 'object',
          description: '格式化选项'
        }
      },
      required: ['value', 'type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        formatted: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '格式化货币',
        params: {
          value: 1234.56,
          type: 'currency',
          locale: 'zh-CN',
          options: {currency: 'CNY'}
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_workflow_executor',
    name: 'workflow_executor',
    display_name: '工作流执行器',
    description: '执行定义好的工作流步骤',
    category: 'automation',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        workflow: {
          type: 'object',
          description: '工作流定义',
          properties: {
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  tool: { type: 'string' },
                  params: { type: 'object' },
                  condition: { type: 'string' }
                }
              }
            }
          }
        },
        context: {
          type: 'object',
          description: '执行上下文'
        }
      },
      required: ['workflow']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '执行数据处理工作流',
        params: {
          workflow: {
            steps: [
              {id: 'read', tool: 'file_reader', params: {filePath: 'data.csv'}},
              {id: 'parse', tool: 'csv_handler', params: {action: 'parse'}}
            ]
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_event_emitter',
    name: 'event_emitter',
    display_name: '事件发射器',
    description: '发布订阅模式的事件系统',
    category: 'automation',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['emit', 'on', 'off', 'once']
        },
        event: {
          type: 'string',
          description: '事件名称'
        },
        data: {
          type: 'any',
          description: '事件数据'
        },
        handler: {
          type: 'string',
          description: '处理函数ID'
        }
      },
      required: ['action', 'event']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '发射数据更新事件',
        params: {
          action: 'emit',
          event: 'data:updated',
          data: {id: 123, status: 'completed'}
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_pipeline_builder',
    name: 'pipeline_builder',
    display_name: '数据管道构建器',
    description: '构建和执行数据处理管道',
    category: 'automation',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        pipeline: {
          type: 'array',
          description: '管道步骤',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              transform: { type: 'string' },
              params: { type: 'object' }
            }
          }
        },
        input: {
          type: 'any',
          description: '输入数据'
        }
      },
      required: ['pipeline', 'input']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        output: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '数据清洗管道',
        params: {
          pipeline: [
            {name: 'filter', transform: 'removeNull'},
            {name: 'map', transform: 'uppercase'}
          ],
          input: ['hello', null, 'world']
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // ==================== 第四批扩展工具 (73-92) ====================

  {
    id: 'tool_blockchain_client',
    name: 'blockchain_client',
    display_name: '区块链客户端',
    description: '连接区块链网络，查询区块、交易信息',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        network: {
          type: 'string',
          description: '区块链网络',
          enum: ['ethereum', 'bsc', 'polygon', 'bitcoin']
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['getBlock', 'getTransaction', 'getBalance', 'getGasPrice']
        },
        params: {
          type: 'object',
          description: '操作参数'
        }
      },
      required: ['network', 'action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '查询以太坊余额',
        params: {
          network: 'ethereum',
          action: 'getBalance',
          params: { address: '0x...' }
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_smart_contract_caller',
    name: 'smart_contract_caller',
    display_name: '智能合约调用器',
    description: '调用智能合约函数、发送交易',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        contractAddress: {
          type: 'string',
          description: '合约地址'
        },
        abi: {
          type: 'array',
          description: '合约ABI'
        },
        method: {
          type: 'string',
          description: '方法名'
        },
        args: {
          type: 'array',
          description: '方法参数'
        },
        from: {
          type: 'string',
          description: '调用者地址'
        }
      },
      required: ['contractAddress', 'abi', 'method']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        transactionHash: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '调用ERC20合约查询余额',
        params: {
          contractAddress: '0x...',
          abi: [],
          method: 'balanceOf',
          args: ['0x...']
        }
      }
    ],
    required_permissions: ['network:http', 'wallet:access'],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_wallet_manager',
    name: 'wallet_manager',
    display_name: '钱包管理器',
    description: '创建钱包、导入私钥、签名交易',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'import', 'sign', 'export']
        },
        privateKey: {
          type: 'string',
          description: '私钥（导入时使用）'
        },
        mnemonic: {
          type: 'string',
          description: '助记词'
        },
        transaction: {
          type: 'object',
          description: '要签名的交易'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        address: { type: 'string' },
        privateKey: { type: 'string' },
        mnemonic: { type: 'string' },
        signature: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '创建新钱包',
        params: {
          action: 'create'
        }
      }
    ],
    required_permissions: ['wallet:create'],
    risk_level: 5,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_email_sender',
    name: 'email_sender',
    display_name: '邮件发送器',
    description: '通过SMTP发送邮件（支持HTML、附件）',
    category: 'communication',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '发件人邮箱'
        },
        to: {
          type: 'array',
          description: '收件人列表',
          items: { type: 'string' }
        },
        subject: {
          type: 'string',
          description: '邮件主题'
        },
        text: {
          type: 'string',
          description: '纯文本内容'
        },
        html: {
          type: 'string',
          description: 'HTML内容'
        },
        attachments: {
          type: 'array',
          description: '附件列表'
        },
        smtpConfig: {
          type: 'object',
          description: 'SMTP配置'
        }
      },
      required: ['from', 'to', 'subject']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        messageId: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '发送文本邮件',
        params: {
          from: 'sender@example.com',
          to: ['recipient@example.com'],
          subject: 'Test Email',
          text: 'Hello World'
        }
      }
    ],
    required_permissions: ['network:smtp'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_email_reader',
    name: 'email_reader',
    display_name: '邮件读取器',
    description: '通过IMAP读取邮件',
    category: 'communication',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imapConfig: {
          type: 'object',
          description: 'IMAP配置',
          properties: {
            host: { type: 'string' },
            port: { type: 'number' },
            user: { type: 'string' },
            password: { type: 'string' },
            tls: { type: 'boolean' }
          }
        },
        mailbox: {
          type: 'string',
          description: '邮箱文件夹',
          default: 'INBOX'
        },
        limit: {
          type: 'number',
          description: '读取数量',
          default: 10
        },
        filter: {
          type: 'object',
          description: '过滤条件'
        }
      },
      required: ['imapConfig']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              subject: { type: 'string' },
              date: { type: 'string' },
              body: { type: 'string' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '读取收件箱邮件',
        params: {
          imapConfig: {
            host: 'imap.example.com',
            port: 993,
            user: 'user@example.com',
            password: 'password',
            tls: true
          },
          limit: 10
        }
      }
    ],
    required_permissions: ['network:imap'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_email_attachment_handler',
    name: 'email_attachment_handler',
    display_name: '邮件附件处理器',
    description: '提取、保存、发送邮件附件',
    category: 'communication',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['extract', 'save', 'attach']
        },
        emailId: {
          type: 'string',
          description: '邮件ID'
        },
        attachmentIndex: {
          type: 'number',
          description: '附件索引'
        },
        savePath: {
          type: 'string',
          description: '保存路径'
        },
        filePath: {
          type: 'string',
          description: '文件路径（添加附件时）'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        attachments: { type: 'array' },
        savedPath: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '提取邮件附件',
        params: {
          action: 'extract',
          emailId: '12345'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_pdf_generator',
    name: 'pdf_generator',
    display_name: 'PDF生成器',
    description: '从HTML、Markdown或模板生成PDF文件',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '内容（HTML或Markdown）'
        },
        contentType: {
          type: 'string',
          description: '内容类型',
          enum: ['html', 'markdown', 'template']
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          description: 'PDF选项',
          properties: {
            format: { type: 'string', default: 'A4' },
            margin: { type: 'object' },
            landscape: { type: 'boolean' }
          }
        }
      },
      required: ['content', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        filePath: { type: 'string' },
        size: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '从HTML生成PDF',
        params: {
          content: '<h1>Hello PDF</h1>',
          contentType: 'html',
          outputPath: '/path/to/output.pdf'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_pdf_text_extractor',
    name: 'pdf_text_extractor',
    display_name: 'PDF文本提取器',
    description: '从PDF文件中提取文本内容',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        pdfPath: {
          type: 'string',
          description: 'PDF文件路径'
        },
        pages: {
          type: 'array',
          description: '要提取的页码（不指定则全部）',
          items: { type: 'number' }
        },
        preserveLayout: {
          type: 'boolean',
          description: '保持布局',
          default: false
        }
      },
      required: ['pdfPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        text: { type: 'string' },
        pageCount: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '提取PDF全文',
        params: {
          pdfPath: '/path/to/document.pdf'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_pdf_merger',
    name: 'pdf_merger',
    display_name: 'PDF合并器',
    description: '合并多个PDF文件、拆分PDF',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['merge', 'split']
        },
        inputFiles: {
          type: 'array',
          description: '输入PDF文件列表',
          items: { type: 'string' }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        pageRanges: {
          type: 'array',
          description: '页码范围（拆分时使用）'
        }
      },
      required: ['action', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        pageCount: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '合并多个PDF',
        params: {
          action: 'merge',
          inputFiles: ['/path/to/1.pdf', '/path/to/2.pdf'],
          outputPath: '/path/to/merged.pdf'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_speech_recognizer',
    name: 'speech_recognizer',
    display_name: '语音识别器',
    description: '将语音转换为文本（ASR）',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: '音频文件路径'
        },
        language: {
          type: 'string',
          description: '语言代码',
          default: 'zh-CN'
        },
        model: {
          type: 'string',
          description: '识别模型',
          enum: ['default', 'whisper', 'google', 'baidu']
        }
      },
      required: ['audioPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        text: { type: 'string' },
        confidence: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '识别中文语音',
        params: {
          audioPath: '/path/to/audio.wav',
          language: 'zh-CN'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_text_to_speech',
    name: 'text_to_speech',
    display_name: '文本转语音',
    description: '将文本转换为语音（TTS）',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '要转换的文本'
        },
        language: {
          type: 'string',
          description: '语言代码',
          default: 'zh-CN'
        },
        voice: {
          type: 'string',
          description: '声音类型',
          enum: ['male', 'female', 'neutral']
        },
        outputPath: {
          type: 'string',
          description: '输出音频路径'
        },
        speed: {
          type: 'number',
          description: '语速（0.5-2.0）',
          default: 1.0
        }
      },
      required: ['text', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        audioPath: { type: 'string' },
        duration: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '中文文本转语音',
        params: {
          text: '你好，世界',
          language: 'zh-CN',
          voice: 'female',
          outputPath: '/path/to/output.mp3'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_audio_converter',
    name: 'audio_converter',
    display_name: '音频格式转换器',
    description: '转换音频格式（MP3、WAV、OGG等）',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '输入文件路径'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        format: {
          type: 'string',
          description: '目标格式',
          enum: ['mp3', 'wav', 'ogg', 'flac', 'aac']
        },
        bitrate: {
          type: 'string',
          description: '比特率',
          default: '192k'
        }
      },
      required: ['inputPath', 'outputPath', 'format']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        size: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'WAV转MP3',
        params: {
          inputPath: '/path/to/audio.wav',
          outputPath: '/path/to/audio.mp3',
          format: 'mp3',
          bitrate: '192k'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_chart_renderer',
    name: 'chart_renderer',
    display_name: '图表渲染器',
    description: '渲染各类图表为图片（PNG、SVG）',
    category: 'visualization',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        chartConfig: {
          type: 'object',
          description: '图表配置（Chart.js格式）'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['png', 'svg', 'pdf'],
          default: 'png'
        },
        width: {
          type: 'number',
          description: '宽度',
          default: 800
        },
        height: {
          type: 'number',
          description: '高度',
          default: 600
        }
      },
      required: ['chartConfig', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imagePath: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '渲染折线图',
        params: {
          chartConfig: {
            type: 'line',
            data: { labels: ['Jan', 'Feb'], datasets: [{ data: [10, 20] }] }
          },
          outputPath: '/path/to/chart.png'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_web_crawler',
    name: 'web_crawler',
    display_name: '网页爬虫',
    description: '爬取网页内容、下载资源',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '目标URL'
        },
        selectors: {
          type: 'object',
          description: 'CSS选择器映射'
        },
        followLinks: {
          type: 'boolean',
          description: '是否跟随链接',
          default: false
        },
        maxDepth: {
          type: 'number',
          description: '最大深度',
          default: 1
        },
        headers: {
          type: 'object',
          description: '请求头'
        }
      },
      required: ['url']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        links: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '爬取网页标题和内容',
        params: {
          url: 'https://example.com',
          selectors: {
            title: 'h1',
            content: '.content'
          }
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_html_extractor',
    name: 'html_extractor',
    display_name: 'HTML内容提取器',
    description: '从HTML中提取特定内容、表格、图片等',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'HTML内容'
        },
        extractType: {
          type: 'string',
          description: '提取类型',
          enum: ['text', 'links', 'images', 'tables', 'metadata']
        },
        selector: {
          type: 'string',
          description: 'CSS选择器'
        }
      },
      required: ['html', 'extractType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        extracted: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '提取所有图片链接',
        params: {
          html: '<html>...</html>',
          extractType: 'images'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_data_validator',
    name: 'data_validator',
    display_name: '数据验证器',
    description: '验证数据类型、范围、格式等',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'any',
          description: '要验证的数据'
        },
        rules: {
          type: 'array',
          description: '验证规则',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              type: { type: 'string' },
              required: { type: 'boolean' },
              min: { type: 'number' },
              max: { type: 'number' },
              pattern: { type: 'string' }
            }
          }
        }
      },
      required: ['data', 'rules']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        valid: { type: 'boolean' },
        errors: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '验证用户数据',
        params: {
          data: { name: 'John', age: 25 },
          rules: [
            { field: 'name', type: 'string', required: true },
            { field: 'age', type: 'number', min: 0, max: 120 }
          ]
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_schema_validator',
    name: 'schema_validator',
    display_name: 'Schema验证器',
    description: '使用JSON Schema验证数据结构',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'any',
          description: '要验证的数据'
        },
        schema: {
          type: 'object',
          description: 'JSON Schema'
        }
      },
      required: ['data', 'schema']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        valid: { type: 'boolean' },
        errors: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '验证用户对象',
        params: {
          data: { name: 'John', age: 25 },
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' }
            },
            required: ['name', 'age']
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_cache_manager',
    name: 'cache_manager',
    display_name: '缓存管理器',
    description: '内存缓存、Redis缓存操作',
    category: 'storage',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['get', 'set', 'delete', 'clear', 'has']
        },
        key: {
          type: 'string',
          description: '缓存键'
        },
        value: {
          type: 'any',
          description: '缓存值'
        },
        ttl: {
          type: 'number',
          description: '过期时间（秒）'
        },
        type: {
          type: 'string',
          description: '缓存类型',
          enum: ['memory', 'redis'],
          default: 'memory'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        value: { type: 'any' },
        exists: { type: 'boolean' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '设置缓存',
        params: {
          action: 'set',
          key: 'user:123',
          value: { name: 'John' },
          ttl: 3600
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_message_queue_client',
    name: 'message_queue_client',
    display_name: '消息队列客户端',
    description: '发布订阅消息、队列操作',
    category: 'messaging',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['publish', 'subscribe', 'consume', 'ack']
        },
        queue: {
          type: 'string',
          description: '队列名称'
        },
        message: {
          type: 'any',
          description: '消息内容'
        },
        exchange: {
          type: 'string',
          description: '交换机名称'
        },
        routingKey: {
          type: 'string',
          description: '路由键'
        }
      },
      required: ['action', 'queue']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        messageId: { type: 'string' },
        messages: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '发布消息',
        params: {
          action: 'publish',
          queue: 'tasks',
          message: { task: 'process', data: {} }
        }
      }
    ],
    required_permissions: ['network:amqp'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_docker_manager',
    name: 'docker_manager',
    display_name: 'Docker管理器',
    description: '管理Docker容器、镜像、网络',
    category: 'devops',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['list', 'start', 'stop', 'remove', 'create', 'exec', 'logs']
        },
        resource: {
          type: 'string',
          description: '资源类型',
          enum: ['container', 'image', 'network', 'volume']
        },
        id: {
          type: 'string',
          description: '容器/镜像ID'
        },
        config: {
          type: 'object',
          description: '创建配置'
        },
        command: {
          type: 'string',
          description: '执行命令'
        }
      },
      required: ['action', 'resource']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'any' },
        output: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '列出所有容器',
        params: {
          action: 'list',
          resource: 'container'
        }
      }
    ],
    required_permissions: ['docker:access'],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },

  // ==================== 第五批扩展工具 (93-112) ====================

  {
    id: 'tool_encrypt_decrypt',
    name: 'encrypt_decrypt',
    display_name: '加密解密器',
    description: '对称/非对称加密、AES、RSA',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['encrypt', 'decrypt']
        },
        data: {
          type: 'string',
          description: '要处理的数据'
        },
        algorithm: {
          type: 'string',
          description: '加密算法',
          enum: ['aes-256-gcm', 'aes-128-cbc', 'rsa']
        },
        key: {
          type: 'string',
          description: '密钥'
        },
        iv: {
          type: 'string',
          description: '初始向量（对称加密）'
        }
      },
      required: ['action', 'data', 'algorithm', 'key']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'AES加密文本',
        params: {
          action: 'encrypt',
          data: 'sensitive data',
          algorithm: 'aes-256-gcm',
          key: '32byteskey...'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_digital_signer',
    name: 'digital_signer',
    display_name: '数字签名器',
    description: '数字签名和验证',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['sign', 'verify']
        },
        data: {
          type: 'string',
          description: '要签名的数据'
        },
        privateKey: {
          type: 'string',
          description: '私钥（签名时）'
        },
        publicKey: {
          type: 'string',
          description: '公钥（验证时）'
        },
        signature: {
          type: 'string',
          description: '签名（验证时）'
        },
        algorithm: {
          type: 'string',
          description: '签名算法',
          enum: ['RSA-SHA256', 'ECDSA'],
          default: 'RSA-SHA256'
        }
      },
      required: ['action', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        signature: { type: 'string' },
        verified: { type: 'boolean' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '签名数据',
        params: {
          action: 'sign',
          data: 'message to sign',
          privateKey: '-----BEGIN PRIVATE KEY-----...'
        }
      }
    ],
    required_permissions: [],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_key_generator',
    name: 'key_generator',
    display_name: '密钥生成器',
    description: '生成加密密钥、密钥对',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '密钥类型',
          enum: ['symmetric', 'rsa', 'ec']
        },
        keySize: {
          type: 'number',
          description: '密钥大小（位）',
          enum: [128, 192, 256, 1024, 2048, 4096]
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['pem', 'der', 'hex'],
          default: 'pem'
        }
      },
      required: ['type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        privateKey: { type: 'string' },
        publicKey: { type: 'string' },
        key: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成RSA密钥对',
        params: {
          type: 'rsa',
          keySize: 2048,
          format: 'pem'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_time_series_analyzer',
    name: 'time_series_analyzer',
    display_name: '时间序列分析器',
    description: '时间序列数据分析、模式识别',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '时间序列数据',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'string' },
              value: { type: 'number' }
            }
          }
        },
        analysis: {
          type: 'array',
          description: '分析类型',
          items: {
            type: 'string',
            enum: ['trend', 'seasonality', 'anomaly', 'forecast']
          }
        },
        forecastPeriods: {
          type: 'number',
          description: '预测周期数',
          default: 10
        }
      },
      required: ['data', 'analysis']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: { type: 'object' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '分析销售趋势',
        params: {
          data: [{timestamp: '2024-01-01', value: 100}, {timestamp: '2024-01-02', value: 120}],
          analysis: ['trend', 'forecast'],
          forecastPeriods: 7
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_trend_detector',
    name: 'trend_detector',
    display_name: '趋势检测器',
    description: '检测数据趋势（上升、下降、平稳）',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          description: '数值数组',
          items: { type: 'number' }
        },
        window: {
          type: 'number',
          description: '滑动窗口大小',
          default: 5
        },
        sensitivity: {
          type: 'number',
          description: '灵敏度（0-1）',
          default: 0.1
        }
      },
      required: ['data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        trend: {
          type: 'string',
          enum: ['upward', 'downward', 'stable', 'volatile']
        },
        strength: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '检测股价趋势',
        params: {
          data: [100, 102, 105, 103, 108, 112, 115],
          window: 3
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_file_watcher',
    name: 'file_watcher',
    display_name: '文件监视器',
    description: '监视文件变化（修改、创建、删除）',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['watch', 'unwatch']
        },
        path: {
          type: 'string',
          description: '监视路径'
        },
        events: {
          type: 'array',
          description: '监听事件',
          items: {
            type: 'string',
            enum: ['change', 'add', 'unlink', 'addDir', 'unlinkDir']
          }
        },
        callback: {
          type: 'string',
          description: '回调函数ID'
        }
      },
      required: ['action', 'path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        watcherId: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '监视配置文件变化',
        params: {
          action: 'watch',
          path: '/config/app.json',
          events: ['change']
        }
      }
    ],
    required_permissions: ['file:watch'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_directory_monitor',
    name: 'directory_monitor',
    display_name: '目录监控器',
    description: '监控目录内文件变化',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: '目录路径'
        },
        recursive: {
          type: 'boolean',
          description: '是否递归监控子目录',
          default: true
        },
        filter: {
          type: 'string',
          description: '文件过滤规则（glob）'
        },
        debounce: {
          type: 'number',
          description: '防抖延迟（毫秒）',
          default: 500
        }
      },
      required: ['directory']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        monitorId: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '监控日志目录',
        params: {
          directory: '/var/log',
          recursive: false,
          filter: '*.log'
        }
      }
    ],
    required_permissions: ['file:watch'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_cron_scheduler',
    name: 'cron_scheduler',
    display_name: 'Cron调度器',
    description: '使用Cron表达式调度任务',
    category: 'automation',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['schedule', 'cancel', 'list']
        },
        cronExpression: {
          type: 'string',
          description: 'Cron表达式（如：0 0 * * *）'
        },
        taskId: {
          type: 'string',
          description: '任务ID'
        },
        task: {
          type: 'object',
          description: '任务定义'
        },
        timezone: {
          type: 'string',
          description: '时区',
          default: 'UTC'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        taskId: { type: 'string' },
        nextRun: { type: 'string' },
        tasks: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '每天凌晨0点执行备份',
        params: {
          action: 'schedule',
          cronExpression: '0 0 * * *',
          task: { type: 'backup', target: 'database' }
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_task_timer',
    name: 'task_timer',
    display_name: '任务定时器',
    description: '延时执行任务、间隔执行',
    category: 'automation',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['setTimeout', 'setInterval', 'clear']
        },
        delay: {
          type: 'number',
          description: '延迟时间（毫秒）'
        },
        interval: {
          type: 'number',
          description: '间隔时间（毫秒）'
        },
        timerId: {
          type: 'string',
          description: '定时器ID'
        },
        task: {
          type: 'object',
          description: '要执行的任务'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        timerId: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '5秒后发送通知',
        params: {
          action: 'setTimeout',
          delay: 5000,
          task: { type: 'notification', message: 'Time is up!' }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_migration_runner',
    name: 'migration_runner',
    display_name: '迁移执行器',
    description: '执行数据库迁移脚本',
    category: 'database',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['up', 'down', 'latest', 'rollback', 'status']
        },
        steps: {
          type: 'number',
          description: '执行步数',
          default: 1
        },
        dryRun: {
          type: 'boolean',
          description: '是否模拟执行',
          default: false
        },
        dbConfig: {
          type: 'object',
          description: '数据库配置'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        executed: { type: 'array' },
        pending: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '执行所有待处理迁移',
        params: {
          action: 'latest',
          dryRun: false
        }
      }
    ],
    required_permissions: ['database:write'],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_schema_differ',
    name: 'schema_differ',
    display_name: 'Schema差异检测器',
    description: '比较数据库Schema差异',
    category: 'database',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'object',
          description: '源Schema'
        },
        target: {
          type: 'object',
          description: '目标Schema'
        },
        options: {
          type: 'object',
          description: '比较选项',
          properties: {
            ignoreColumnOrder: { type: 'boolean', default: true },
            ignoreConstraints: { type: 'boolean', default: false }
          }
        }
      },
      required: ['source', 'target']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        differences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              table: { type: 'string' },
              column: { type: 'string' },
              change: { type: 'string' }
            }
          }
        },
        sqlStatements: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '比较开发和生产环境Schema',
        params: {
          source: { /* dev schema */ },
          target: { /* prod schema */ }
        }
      }
    ],
    required_permissions: ['database:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_websocket_server',
    name: 'websocket_server',
    display_name: 'WebSocket服务器',
    description: '创建和管理WebSocket服务器',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['start', 'stop', 'broadcast', 'send']
        },
        port: {
          type: 'number',
          description: '端口号',
          default: 8080
        },
        message: {
          type: 'any',
          description: '消息内容'
        },
        clientId: {
          type: 'string',
          description: '客户端ID（发送单个消息时）'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        serverId: { type: 'string' },
        clients: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '启动WebSocket服务器',
        params: {
          action: 'start',
          port: 8080
        }
      }
    ],
    required_permissions: ['network:listen'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_websocket_client',
    name: 'websocket_client',
    display_name: 'WebSocket客户端',
    description: '连接WebSocket服务器',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['connect', 'disconnect', 'send', 'subscribe']
        },
        url: {
          type: 'string',
          description: 'WebSocket URL'
        },
        message: {
          type: 'any',
          description: '消息内容'
        },
        connectionId: {
          type: 'string',
          description: '连接ID'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        connectionId: { type: 'string' },
        data: { type: 'any' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '连接WebSocket服务器',
        params: {
          action: 'connect',
          url: 'ws://localhost:8080'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_barcode_generator',
    name: 'barcode_generator',
    display_name: '条形码生成器',
    description: '生成各类条形码（Code128、EAN、UPC等）',
    category: 'image',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        data: {
          type: 'string',
          description: '条形码数据'
        },
        format: {
          type: 'string',
          description: '条形码格式',
          enum: ['CODE128', 'EAN13', 'EAN8', 'UPC', 'CODE39']
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          description: '生成选项',
          properties: {
            width: { type: 'number', default: 2 },
            height: { type: 'number', default: 100 },
            displayValue: { type: 'boolean', default: true }
          }
        }
      },
      required: ['data', 'format', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imagePath: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '生成EAN13条形码',
        params: {
          data: '1234567890128',
          format: 'EAN13',
          outputPath: '/barcodes/product.png'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_code_recognizer',
    name: 'code_recognizer',
    display_name: '码识别器',
    description: '识别图片中的二维码和条形码',
    category: 'image',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '图片路径'
        },
        type: {
          type: 'string',
          description: '识别类型',
          enum: ['qrcode', 'barcode', 'auto'],
          default: 'auto'
        }
      },
      required: ['imagePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        codes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              data: { type: 'string' },
              format: { type: 'string' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '识别图片中的二维码',
        params: {
          imagePath: '/images/qr.png',
          type: 'qrcode'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_geocoder',
    name: 'geocoder',
    display_name: '地理编码器',
    description: '地址和坐标互相转换',
    category: 'location',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['geocode', 'reverse']
        },
        address: {
          type: 'string',
          description: '地址（正向编码）'
        },
        latitude: {
          type: 'number',
          description: '纬度（反向编码）'
        },
        longitude: {
          type: 'number',
          description: '经度（反向编码）'
        },
        provider: {
          type: 'string',
          description: '服务提供商',
          enum: ['google', 'baidu', 'amap'],
          default: 'google'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        address: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '地址转坐标',
        params: {
          action: 'geocode',
          address: '北京市朝阳区',
          provider: 'baidu'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_distance_calculator',
    name: 'distance_calculator',
    display_name: '距离计算器',
    description: '计算两点间距离（支持多种算法）',
    category: 'location',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        point1: {
          type: 'object',
          description: '起点坐标',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' }
          }
        },
        point2: {
          type: 'object',
          description: '终点坐标',
          properties: {
            latitude: { type: 'number' },
            longitude: { type: 'number' }
          }
        },
        algorithm: {
          type: 'string',
          description: '计算算法',
          enum: ['haversine', 'vincenty'],
          default: 'haversine'
        },
        unit: {
          type: 'string',
          description: '距离单位',
          enum: ['km', 'mi', 'm'],
          default: 'km'
        }
      },
      required: ['point1', 'point2']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        distance: { type: 'number' },
        unit: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '计算北京到上海距离',
        params: {
          point1: {latitude: 39.9042, longitude: 116.4074},
          point2: {latitude: 31.2304, longitude: 121.4737},
          unit: 'km'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_coordinate_converter',
    name: 'coordinate_converter',
    display_name: '坐标转换器',
    description: '不同坐标系统间转换（WGS84、GCJ02、BD09）',
    category: 'location',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: '纬度'
        },
        longitude: {
          type: 'number',
          description: '经度'
        },
        from: {
          type: 'string',
          description: '源坐标系',
          enum: ['WGS84', 'GCJ02', 'BD09']
        },
        to: {
          type: 'string',
          description: '目标坐标系',
          enum: ['WGS84', 'GCJ02', 'BD09']
        }
      },
      required: ['latitude', 'longitude', 'from', 'to']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: 'WGS84转GCJ02（GPS转高德）',
        params: {
          latitude: 39.9042,
          longitude: 116.4074,
          from: 'WGS84',
          to: 'GCJ02'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_video_editor',
    name: 'video_editor',
    display_name: '视频编辑器',
    description: '视频剪辑、合并、裁剪',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['cut', 'merge', 'crop', 'watermark']
        },
        inputPath: {
          type: 'string',
          description: '输入视频路径'
        },
        outputPath: {
          type: 'string',
          description: '输出视频路径'
        },
        startTime: {
          type: 'string',
          description: '开始时间（HH:MM:SS）'
        },
        endTime: {
          type: 'string',
          description: '结束时间（HH:MM:SS）'
        },
        watermark: {
          type: 'object',
          description: '水印配置'
        }
      },
      required: ['action', 'inputPath', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        duration: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '剪辑视频片段',
        params: {
          action: 'cut',
          inputPath: '/videos/source.mp4',
          outputPath: '/videos/output.mp4',
          startTime: '00:01:00',
          endTime: '00:02:30'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_video_transcoder',
    name: 'video_transcoder',
    display_name: '视频转码器',
    description: '视频格式转换、编码转换',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '输入视频路径'
        },
        outputPath: {
          type: 'string',
          description: '输出视频路径'
        },
        codec: {
          type: 'string',
          description: '视频编码',
          enum: ['h264', 'h265', 'vp9', 'av1']
        },
        resolution: {
          type: 'string',
          description: '分辨率',
          enum: ['480p', '720p', '1080p', '4k']
        },
        bitrate: {
          type: 'string',
          description: '比特率'
        }
      },
      required: ['inputPath', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        size: { type: 'number' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '转码为H265 1080p',
        params: {
          inputPath: '/videos/source.mp4',
          outputPath: '/videos/compressed.mp4',
          codec: 'h265',
          resolution: '1080p'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_video_screenshot',
    name: 'video_screenshot',
    display_name: '视频截图器',
    description: '从视频中截取帧作为图片',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        videoPath: {
          type: 'string',
          description: '视频文件路径'
        },
        outputPath: {
          type: 'string',
          description: '输出图片路径'
        },
        timestamp: {
          type: 'string',
          description: '时间点（HH:MM:SS）'
        },
        count: {
          type: 'number',
          description: '截图数量',
          default: 1
        },
        interval: {
          type: 'number',
          description: '间隔（秒）'
        }
      },
      required: ['videoPath', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        screenshots: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '截取视频第10秒画面',
        params: {
          videoPath: '/videos/movie.mp4',
          outputPath: '/screenshots/frame.jpg',
          timestamp: '00:00:10'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_code_linter',
    name: 'code_linter',
    display_name: '代码检查器',
    description: '代码质量和风格检查',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '代码内容'
        },
        language: {
          type: 'string',
          description: '编程语言',
          enum: ['javascript', 'typescript', 'python', 'java', 'go']
        },
        rules: {
          type: 'object',
          description: '检查规则配置'
        },
        fix: {
          type: 'boolean',
          description: '是否自动修复',
          default: false
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number' },
              column: { type: 'number' },
              severity: { type: 'string' },
              message: { type: 'string' },
              rule: { type: 'string' }
            }
          }
        },
        fixedCode: { type: 'string' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '检查JavaScript代码',
        params: {
          code: 'var x = 1;\nconsole.log(x)',
          language: 'javascript',
          fix: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_ast_parser',
    name: 'ast_parser',
    display_name: 'AST解析器',
    description: '解析代码为抽象语法树',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '代码内容'
        },
        language: {
          type: 'string',
          description: '编程语言',
          enum: ['javascript', 'typescript', 'python', 'java']
        },
        includeComments: {
          type: 'boolean',
          description: '是否包含注释',
          default: false
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        ast: { type: 'object' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '解析JavaScript代码',
        params: {
          code: 'function add(a, b) { return a + b; }',
          language: 'javascript'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_complexity_calculator',
    name: 'complexity_calculator',
    display_name: '复杂度计算器',
    description: '计算代码圈复杂度、认知复杂度',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: '代码内容'
        },
        language: {
          type: 'string',
          description: '编程语言',
          enum: ['javascript', 'typescript', 'python', 'java']
        },
        metrics: {
          type: 'array',
          description: '要计算的指标',
          items: {
            type: 'string',
            enum: ['cyclomatic', 'cognitive', 'halstead', 'loc']
          }
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        complexity: {
          type: 'object',
          properties: {
            cyclomatic: { type: 'number' },
            cognitive: { type: 'number' },
            halstead: { type: 'object' },
            loc: { type: 'number' }
          }
        },
        functions: { type: 'array' },
        error: { type: 'string' }
      }
    },
    examples: [
      {
        description: '计算函数复杂度',
        params: {
          code: 'function complex(x) { if (x > 0) { for (let i = 0; i < x; i++) { if (i % 2 === 0) { console.log(i); } } } }',
          language: 'javascript',
          metrics: ['cyclomatic', 'cognitive']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
];
