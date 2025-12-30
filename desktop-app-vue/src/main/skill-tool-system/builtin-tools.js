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

  // =============== 第六批工具扩展 (113-132) ===============

  // 3D建模工具 (113-114)
  {
    id: 'tool_model_generator',
    name: 'model_generator',
    display_name: '3D模型生成器',
    description: '生成基础3D几何模型(立方体、球体、圆柱等)',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '模型类型',
          enum: ['cube', 'sphere', 'cylinder', 'cone', 'plane']
        },
        dimensions: {
          type: 'object',
          description: '尺寸参数',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
            depth: { type: 'number' },
            radius: { type: 'number' },
            segments: { type: 'number' }
          }
        },
        material: {
          type: 'object',
          description: '材质属性',
          properties: {
            color: { type: 'string' },
            texture: { type: 'string' },
            opacity: { type: 'number' }
          }
        },
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['obj', 'stl', 'gltf', 'fbx']
        }
      },
      required: ['type', 'dimensions']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        modelPath: { type: 'string' },
        vertices: { type: 'number' },
        faces: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_model_converter',
    name: 'model_converter',
    display_name: '模型格式转换器',
    description: '转换3D模型文件格式(OBJ/STL/GLTF/FBX)',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '输入模型文件路径'
        },
        inputFormat: {
          type: 'string',
          description: '输入格式',
          enum: ['obj', 'stl', 'gltf', 'fbx', 'dae', '3ds']
        },
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['obj', 'stl', 'gltf', 'fbx']
        },
        options: {
          type: 'object',
          description: '转换选项',
          properties: {
            optimize: { type: 'boolean' },
            scale: { type: 'number' },
            centerModel: { type: 'boolean' }
          }
        }
      },
      required: ['inputPath', 'inputFormat', 'outputFormat']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        outputPath: { type: 'string' },
        fileSize: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read', 'file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 音频分析工具 (115-116)
  {
    id: 'tool_speech_recognizer',
    name: 'speech_recognizer',
    display_name: '语音识别器',
    description: '将音频转换为文本,支持多种语言',
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
          description: '识别语言',
          enum: ['zh-CN', 'en-US', 'ja-JP', 'ko-KR']
        },
        options: {
          type: 'object',
          description: '识别选项',
          properties: {
            punctuation: { type: 'boolean' },
            timestamps: { type: 'boolean' },
            speakerDiarization: { type: 'boolean' }
          }
        }
      },
      required: ['audioPath', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        text: { type: 'string' },
        confidence: { type: 'number' },
        segments: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_audio_fingerprint',
    name: 'audio_fingerprint',
    display_name: '音频指纹生成器',
    description: '生成音频指纹用于音乐识别和去重',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        audioPath: {
          type: 'string',
          description: '音频文件路径'
        },
        algorithm: {
          type: 'string',
          description: '指纹算法',
          enum: ['chromaprint', 'echoprint', 'acoustid']
        },
        duration: {
          type: 'number',
          description: '分析时长(秒)'
        }
      },
      required: ['audioPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        fingerprint: { type: 'string' },
        duration: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 区块链工具 (117-118)
  {
    id: 'tool_contract_caller',
    name: 'contract_caller',
    display_name: '智能合约调用器',
    description: '调用以太坊智能合约方法',
    category: 'network',
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
        params: {
          type: 'array',
          description: '方法参数'
        },
        network: {
          type: 'string',
          description: '网络类型',
          enum: ['mainnet', 'testnet', 'localhost']
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
        gasUsed: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_wallet_manager',
    name: 'wallet_manager',
    display_name: '钱包管理器',
    description: '管理加密货币钱包(创建、导入、余额查询)',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'import', 'getBalance', 'sign']
        },
        mnemonic: {
          type: 'string',
          description: '助记词(导入时使用)'
        },
        address: {
          type: 'string',
          description: '钱包地址'
        },
        network: {
          type: 'string',
          description: '区块链网络',
          enum: ['ethereum', 'bitcoin', 'polygon']
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        address: { type: 'string' },
        balance: { type: 'string' },
        mnemonic: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['crypto.wallet'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  // 数据可视化工具 (119-120)
  {
    id: 'tool_chart_generator',
    name: 'chart_generator',
    display_name: '图表生成器',
    description: '生成各类统计图表(折线图、柱状图、饼图等)',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        chartType: {
          type: 'string',
          description: '图表类型',
          enum: ['line', 'bar', 'pie', 'scatter', 'area', 'radar']
        },
        data: {
          type: 'object',
          description: '图表数据',
          properties: {
            labels: { type: 'array' },
            datasets: { type: 'array' }
          }
        },
        options: {
          type: 'object',
          description: '图表选项',
          properties: {
            title: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            theme: { type: 'string' }
          }
        },
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['png', 'svg', 'pdf', 'html']
        }
      },
      required: ['chartType', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        chartPath: { type: 'string' },
        chartData: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_graph_plotter',
    name: 'graph_plotter',
    display_name: '图形绘制器',
    description: '绘制数学函数图形和数据点',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: '绘图类型',
          enum: ['function', 'points', 'heatmap', 'contour']
        },
        expression: {
          type: 'string',
          description: '数学表达式(如 "x^2 + 2*x + 1")'
        },
        points: {
          type: 'array',
          description: '数据点数组'
        },
        range: {
          type: 'object',
          description: '坐标范围',
          properties: {
            xMin: { type: 'number' },
            xMax: { type: 'number' },
            yMin: { type: 'number' },
            yMax: { type: 'number' }
          }
        }
      },
      required: ['type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        imagePath: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // IoT集成工具 (121-122)
  {
    id: 'tool_device_manager',
    name: 'device_manager',
    display_name: '设备管理器',
    description: 'IoT设备注册、配置、状态管理',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['register', 'configure', 'getStatus', 'control']
        },
        deviceId: {
          type: 'string',
          description: '设备ID'
        },
        deviceType: {
          type: 'string',
          description: '设备类型',
          enum: ['sensor', 'actuator', 'gateway', 'controller']
        },
        config: {
          type: 'object',
          description: '设备配置参数'
        },
        command: {
          type: 'object',
          description: '控制命令'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        deviceId: { type: 'string' },
        status: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_mqtt_client',
    name: 'mqtt_client',
    display_name: 'MQTT客户端',
    description: 'MQTT消息发布订阅',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['connect', 'publish', 'subscribe', 'unsubscribe']
        },
        broker: {
          type: 'string',
          description: 'MQTT代理地址'
        },
        topic: {
          type: 'string',
          description: '主题'
        },
        message: {
          type: 'string',
          description: '消息内容'
        },
        qos: {
          type: 'number',
          description: '服务质量等级',
          enum: [0, 1, 2]
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        connected: { type: 'boolean' },
        messages: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 机器学习工具 (123-124)
  {
    id: 'tool_model_trainer',
    name: 'model_trainer',
    display_name: '模型训练器',
    description: '训练机器学习模型',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelType: {
          type: 'string',
          description: '模型类型',
          enum: ['linear', 'decision_tree', 'random_forest', 'neural_network']
        },
        trainingData: {
          type: 'array',
          description: '训练数据'
        },
        labels: {
          type: 'array',
          description: '标签数据'
        },
        hyperparameters: {
          type: 'object',
          description: '超参数配置'
        },
        validationSplit: {
          type: 'number',
          description: '验证集比例'
        }
      },
      required: ['modelType', 'trainingData', 'labels']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        modelPath: { type: 'string' },
        accuracy: { type: 'number' },
        metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_model_predictor',
    name: 'model_predictor',
    display_name: '模型预测器',
    description: '使用训练好的模型进行预测',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelPath: {
          type: 'string',
          description: '模型文件路径'
        },
        inputData: {
          type: 'array',
          description: '输入数据'
        },
        options: {
          type: 'object',
          description: '预测选项',
          properties: {
            batchSize: { type: 'number' },
            threshold: { type: 'number' }
          }
        }
      },
      required: ['modelPath', 'inputData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        predictions: { type: 'array' },
        confidence: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 自然语言处理工具 (125-126)
  {
    id: 'tool_text_classifier',
    name: 'text_classifier',
    display_name: '文本分类器',
    description: '对文本进行分类(主题、情感、意图等)',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '待分类文本'
        },
        taskType: {
          type: 'string',
          description: '分类任务类型',
          enum: ['topic', 'sentiment', 'intent', 'language']
        },
        model: {
          type: 'string',
          description: '使用的模型'
        },
        categories: {
          type: 'array',
          description: '候选类别列表'
        }
      },
      required: ['text', 'taskType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        category: { type: 'string' },
        confidence: { type: 'number' },
        scores: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_entity_recognizer',
    name: 'entity_recognizer',
    display_name: '实体识别器',
    description: '识别文本中的命名实体(人名、地名、组织等)',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: '待分析文本'
        },
        entityTypes: {
          type: 'array',
          description: '要识别的实体类型',
          items: {
            type: 'string',
            enum: ['person', 'location', 'organization', 'date', 'money', 'email']
          }
        },
        language: {
          type: 'string',
          description: '文本语言',
          enum: ['zh', 'en']
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              type: { type: 'string' },
              startIndex: { type: 'number' },
              endIndex: { type: 'number' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 性能监控工具 (127-128)
  {
    id: 'tool_resource_monitor',
    name: 'resource_monitor',
    display_name: '资源监控器',
    description: '监控CPU、内存、磁盘、网络等系统资源',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        metrics: {
          type: 'array',
          description: '监控指标',
          items: {
            type: 'string',
            enum: ['cpu', 'memory', 'disk', 'network', 'process']
          }
        },
        interval: {
          type: 'number',
          description: '采样间隔(毫秒)'
        },
        duration: {
          type: 'number',
          description: '监控时长(秒)'
        }
      },
      required: ['metrics']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            cpu: { type: 'number' },
            memory: { type: 'object' },
            disk: { type: 'object' },
            network: { type: 'object' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.info'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_performance_profiler',
    name: 'performance_profiler',
    display_name: '性能分析器',
    description: '分析代码性能、识别性能瓶颈',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: '分析目标',
          enum: ['function', 'module', 'application']
        },
        code: {
          type: 'string',
          description: '要分析的代码'
        },
        options: {
          type: 'object',
          description: '分析选项',
          properties: {
            iterations: { type: 'number' },
            warmup: { type: 'number' },
            detailed: { type: 'boolean' }
          }
        }
      },
      required: ['target']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        executionTime: { type: 'number' },
        memoryUsage: { type: 'number' },
        bottlenecks: { type: 'array' },
        suggestions: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 协议缓冲工具 (129-130)
  {
    id: 'tool_protobuf_encoder',
    name: 'protobuf_encoder',
    display_name: 'Protobuf编码器',
    description: '将JSON数据编码为Protocol Buffer格式',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        schema: {
          type: 'string',
          description: 'Protobuf模式定义(.proto文件路径)'
        },
        messageName: {
          type: 'string',
          description: '消息类型名称'
        },
        data: {
          type: 'object',
          description: '要编码的数据(JSON格式)'
        },
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['binary', 'base64', 'hex']
        }
      },
      required: ['schema', 'messageName', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        encoded: { type: 'string' },
        size: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_protobuf_decoder',
    name: 'protobuf_decoder',
    display_name: 'Protobuf解码器',
    description: '将Protocol Buffer数据解码为JSON',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        schema: {
          type: 'string',
          description: 'Protobuf模式定义(.proto文件路径)'
        },
        messageName: {
          type: 'string',
          description: '消息类型名称'
        },
        data: {
          type: 'string',
          description: '编码后的数据'
        },
        inputFormat: {
          type: 'string',
          description: '输入格式',
          enum: ['binary', 'base64', 'hex']
        }
      },
      required: ['schema', 'messageName', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        decoded: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 搜索引擎工具 (131-132)
  {
    id: 'tool_search_indexer',
    name: 'search_indexer',
    display_name: '搜索索引器',
    description: '构建和管理全文搜索索引',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'add', 'update', 'delete', 'optimize']
        },
        indexName: {
          type: 'string',
          description: '索引名称'
        },
        documents: {
          type: 'array',
          description: '文档数组',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object' }
            }
          }
        },
        analyzer: {
          type: 'string',
          description: '分词器',
          enum: ['standard', 'chinese', 'english']
        }
      },
      required: ['action', 'indexName']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        indexed: { type: 'number' },
        totalDocuments: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_search_query',
    name: 'search_query',
    display_name: '搜索查询器',
    description: '执行全文搜索查询',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: '索引名称'
        },
        query: {
          type: 'string',
          description: '搜索查询'
        },
        options: {
          type: 'object',
          description: '查询选项',
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
            filters: { type: 'object' },
            sortBy: { type: 'string' },
            highlight: { type: 'boolean' }
          }
        }
      },
      required: ['indexName', 'query']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              score: { type: 'number' },
              highlights: { type: 'array' }
            }
          }
        },
        total: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // =============== 第七批工具扩展 (137-156) ===============

  // 网络安全工具 (137-138)
  {
    id: 'tool_vulnerability_scanner',
    name: 'vulnerability_scanner',
    display_name: '漏洞扫描器',
    description: '扫描系统/网络/应用漏洞,生成安全报告',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: '扫描目标(IP/域名/URL)'
        },
        scanType: {
          type: 'string',
          description: '扫描类型',
          enum: ['port', 'web', 'network', 'full']
        },
        depth: {
          type: 'string',
          description: '扫描深度',
          enum: ['quick', 'medium', 'deep']
        },
        options: {
          type: 'object',
          description: '扫描选项',
          properties: {
            timeout: { type: 'number' },
            concurrent: { type: 'number' },
            aggressive: { type: 'boolean' }
          }
        }
      },
      required: ['target', 'scanType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        vulnerabilities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string' },
              type: { type: 'string' },
              description: { type: 'string' },
              cve: { type: 'string' }
            }
          }
        },
        risk_score: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.scan'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_security_auditor',
    name: 'security_auditor',
    display_name: '安全审计器',
    description: '代码/配置安全审计,检测安全问题',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        auditType: {
          type: 'string',
          description: '审计类型',
          enum: ['code', 'config', 'system', 'compliance']
        },
        target: {
          type: 'string',
          description: '审计目标路径'
        },
        rules: {
          type: 'array',
          description: '审计规则集',
          items: { type: 'string' }
        },
        standard: {
          type: 'string',
          description: '安全标准',
          enum: ['owasp', 'cis', 'pci-dss', 'iso27001']
        }
      },
      required: ['auditType', 'target']
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
              severity: { type: 'string' },
              rule: { type: 'string' },
              location: { type: 'string' },
              recommendation: { type: 'string' }
            }
          }
        },
        compliance_score: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 游戏引擎工具 (139-140)
  {
    id: 'tool_physics_engine',
    name: 'physics_engine',
    display_name: '物理引擎',
    description: '2D/3D物理模拟,刚体动力学计算',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'step', 'applyForce', 'setVelocity']
        },
        objectId: {
          type: 'string',
          description: '物体ID'
        },
        properties: {
          type: 'object',
          description: '物理属性',
          properties: {
            mass: { type: 'number' },
            friction: { type: 'number' },
            restitution: { type: 'number' },
            position: { type: 'array' },
            velocity: { type: 'array' }
          }
        },
        force: {
          type: 'array',
          description: '施加的力向量'
        },
        deltaTime: {
          type: 'number',
          description: '时间步长(秒)'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        objectId: { type: 'string' },
        state: {
          type: 'object',
          properties: {
            position: { type: 'array' },
            velocity: { type: 'array' },
            rotation: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_collision_detector',
    name: 'collision_detector',
    display_name: '碰撞检测器',
    description: '检测物体碰撞,计算碰撞响应',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        objects: {
          type: 'array',
          description: '参与检测的物体列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              shape: { type: 'string' },
              bounds: { type: 'object' }
            }
          }
        },
        algorithm: {
          type: 'string',
          description: '检测算法',
          enum: ['aabb', 'sat', 'gjk', 'quadtree']
        },
        continuous: {
          type: 'boolean',
          description: '是否连续碰撞检测'
        }
      },
      required: ['objects']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        collisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              objectA: { type: 'string' },
              objectB: { type: 'string' },
              point: { type: 'array' },
              normal: { type: 'array' },
              depth: { type: 'number' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // GIS工具 (141-142)
  {
    id: 'tool_spatial_analyzer',
    name: 'spatial_analyzer',
    display_name: '空间分析器',
    description: 'GIS空间分析,缓冲区/叠加/聚类分析',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['buffer', 'overlay', 'proximity', 'cluster', 'hotspot']
        },
        inputData: {
          type: 'object',
          description: '输入GeoJSON数据'
        },
        parameters: {
          type: 'object',
          description: '分析参数',
          properties: {
            distance: { type: 'number' },
            unit: { type: 'string' },
            method: { type: 'string' }
          }
        }
      },
      required: ['analysisType', 'inputData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          description: 'GeoJSON结果'
        },
        statistics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_route_planner',
    name: 'route_planner',
    display_name: '路径规划器',
    description: '最优路径规划,支持多种算法',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        start: {
          type: 'object',
          description: '起点坐标',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' }
          }
        },
        end: {
          type: 'object',
          description: '终点坐标',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' }
          }
        },
        waypoints: {
          type: 'array',
          description: '途经点列表'
        },
        algorithm: {
          type: 'string',
          description: '路径算法',
          enum: ['dijkstra', 'astar', 'bidirectional', 'tsp']
        },
        constraints: {
          type: 'object',
          description: '约束条件',
          properties: {
            avoid_tolls: { type: 'boolean' },
            avoid_highways: { type: 'boolean' },
            max_distance: { type: 'number' }
          }
        }
      },
      required: ['start', 'end']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        route: {
          type: 'object',
          properties: {
            path: { type: 'array' },
            distance: { type: 'number' },
            duration: { type: 'number' },
            steps: { type: 'array' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 生物信息学工具 (143-144)
  {
    id: 'tool_sequence_aligner',
    name: 'sequence_aligner',
    display_name: '序列比对器',
    description: 'DNA/RNA/蛋白质序列比对分析',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sequences: {
          type: 'array',
          description: '待比对序列列表',
          items: { type: 'string' }
        },
        algorithm: {
          type: 'string',
          description: '比对算法',
          enum: ['needleman-wunsch', 'smith-waterman', 'blast', 'clustalw']
        },
        sequenceType: {
          type: 'string',
          description: '序列类型',
          enum: ['dna', 'rna', 'protein']
        },
        parameters: {
          type: 'object',
          description: '比对参数',
          properties: {
            match_score: { type: 'number' },
            mismatch_penalty: { type: 'number' },
            gap_penalty: { type: 'number' }
          }
        }
      },
      required: ['sequences', 'algorithm']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        alignment: {
          type: 'array',
          items: { type: 'string' }
        },
        score: { type: 'number' },
        identity: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_protein_predictor',
    name: 'protein_predictor',
    display_name: '蛋白质结构预测器',
    description: '预测蛋白质二级/三级结构',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sequence: {
          type: 'string',
          description: '氨基酸序列'
        },
        predictionType: {
          type: 'string',
          description: '预测类型',
          enum: ['secondary', 'tertiary', 'disorder', 'binding_site']
        },
        method: {
          type: 'string',
          description: '预测方法',
          enum: ['alphafold', 'rosetta', 'modeller', 'chou-fasman']
        }
      },
      required: ['sequence', 'predictionType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        prediction: {
          type: 'object',
          properties: {
            structure: { type: 'string' },
            confidence: { type: 'number' },
            coordinates: { type: 'array' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 财务分析工具 (145-146)
  {
    id: 'tool_financial_modeler',
    name: 'financial_modeler',
    display_name: '财务建模器',
    description: '财务模型构建,DCF/NPV/IRR计算',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelType: {
          type: 'string',
          description: '模型类型',
          enum: ['dcf', 'npv', 'irr', 'capm', 'black_scholes']
        },
        inputs: {
          type: 'object',
          description: '模型输入参数',
          properties: {
            cash_flows: { type: 'array' },
            discount_rate: { type: 'number' },
            initial_investment: { type: 'number' },
            risk_free_rate: { type: 'number' }
          }
        },
        assumptions: {
          type: 'object',
          description: '假设条件'
        }
      },
      required: ['modelType', 'inputs']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            value: { type: 'number' },
            npv: { type: 'number' },
            irr: { type: 'number' },
            payback_period: { type: 'number' }
          }
        },
        sensitivity_analysis: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_risk_analyzer',
    name: 'risk_analyzer',
    display_name: '风险分析器',
    description: '投资风险评估,VaR/CVaR计算',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        portfolio: {
          type: 'array',
          description: '投资组合',
          items: {
            type: 'object',
            properties: {
              asset: { type: 'string' },
              weight: { type: 'number' },
              returns: { type: 'array' }
            }
          }
        },
        riskMetrics: {
          type: 'array',
          description: '风险指标',
          items: {
            type: 'string',
            enum: ['var', 'cvar', 'sharpe', 'beta', 'volatility']
          }
        },
        confidence_level: {
          type: 'number',
          description: '置信水平'
        },
        time_horizon: {
          type: 'number',
          description: '时间范围(天)'
        }
      },
      required: ['portfolio', 'riskMetrics']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        risk_metrics: {
          type: 'object',
          properties: {
            var: { type: 'number' },
            cvar: { type: 'number' },
            sharpe_ratio: { type: 'number' },
            beta: { type: 'number' },
            volatility: { type: 'number' }
          }
        },
        recommendations: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 教育辅助工具 (147-148)
  {
    id: 'tool_exercise_generator',
    name: 'exercise_generator',
    display_name: '习题生成器',
    description: '自动生成各学科习题,支持难度分级',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: '学科',
          enum: ['math', 'physics', 'chemistry', 'english', 'programming']
        },
        topic: {
          type: 'string',
          description: '知识点'
        },
        difficulty: {
          type: 'string',
          description: '难度等级',
          enum: ['easy', 'medium', 'hard', 'expert']
        },
        count: {
          type: 'number',
          description: '生成数量'
        },
        type: {
          type: 'string',
          description: '题型',
          enum: ['choice', 'blank', 'essay', 'calculation', 'coding']
        }
      },
      required: ['subject', 'topic', 'difficulty']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              options: { type: 'array' },
              answer: { type: 'string' },
              explanation: { type: 'string' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_auto_grader',
    name: 'auto_grader',
    display_name: '自动批改器',
    description: '自动批改作业/试卷,生成评分报告',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        submissions: {
          type: 'array',
          description: '学生提交列表',
          items: {
            type: 'object',
            properties: {
              student_id: { type: 'string' },
              answers: { type: 'array' }
            }
          }
        },
        answer_key: {
          type: 'array',
          description: '标准答案'
        },
        grading_rubric: {
          type: 'object',
          description: '评分标准',
          properties: {
            total_points: { type: 'number' },
            partial_credit: { type: 'boolean' }
          }
        },
        feedback_level: {
          type: 'string',
          description: '反馈详细程度',
          enum: ['minimal', 'standard', 'detailed']
        }
      },
      required: ['submissions', 'answer_key']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              student_id: { type: 'string' },
              score: { type: 'number' },
              feedback: { type: 'array' },
              strengths: { type: 'array' },
              weaknesses: { type: 'array' }
            }
          }
        },
        statistics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 医疗健康工具 (149-150)
  {
    id: 'tool_medical_image_analyzer',
    name: 'medical_image_analyzer',
    display_name: '医学影像分析器',
    description: 'CT/MRI/X光影像分析,病灶检测',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '影像文件路径'
        },
        imageType: {
          type: 'string',
          description: '影像类型',
          enum: ['ct', 'mri', 'xray', 'ultrasound', 'pet']
        },
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['lesion_detection', 'segmentation', 'classification', 'measurement']
        },
        bodyPart: {
          type: 'string',
          description: '身体部位',
          enum: ['brain', 'chest', 'abdomen', 'bone', 'heart']
        }
      },
      required: ['imagePath', 'imageType', 'analysisType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              location: { type: 'object' },
              confidence: { type: 'number' },
              severity: { type: 'string' }
            }
          }
        },
        measurements: { type: 'object' },
        visualization: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_health_monitor',
    name: 'health_monitor',
    display_name: '健康监测器',
    description: '健康数据分析,异常检测,健康建议',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        metrics: {
          type: 'object',
          description: '健康指标',
          properties: {
            heart_rate: { type: 'number' },
            blood_pressure: { type: 'object' },
            temperature: { type: 'number' },
            sleep_hours: { type: 'number' },
            steps: { type: 'number' }
          }
        },
        history: {
          type: 'array',
          description: '历史数据'
        },
        user_profile: {
          type: 'object',
          description: '用户信息',
          properties: {
            age: { type: 'number' },
            gender: { type: 'string' },
            conditions: { type: 'array' }
          }
        }
      },
      required: ['metrics']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        analysis: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            anomalies: { type: 'array' },
            trends: { type: 'object' }
          }
        },
        recommendations: { type: 'array' },
        risk_assessment: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 法律辅助工具 (151-152)
  {
    id: 'tool_legal_document_generator',
    name: 'legal_document_generator',
    display_name: '法律文书生成器',
    description: '生成合同/起诉状/答辩状等法律文书',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          description: '文书类型',
          enum: ['contract', 'complaint', 'answer', 'motion', 'agreement']
        },
        template: {
          type: 'string',
          description: '模板名称'
        },
        parties: {
          type: 'array',
          description: '当事人信息',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              address: { type: 'string' }
            }
          }
        },
        clauses: {
          type: 'array',
          description: '条款内容'
        },
        jurisdiction: {
          type: 'string',
          description: '法域',
          enum: ['cn', 'us', 'uk', 'eu']
        }
      },
      required: ['documentType', 'parties']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        document: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            format: { type: 'string' },
            metadata: { type: 'object' }
          }
        },
        warnings: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_case_searcher',
    name: 'case_searcher',
    display_name: '案例检索器',
    description: '法律案例/判例/法规检索',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索查询'
        },
        searchType: {
          type: 'string',
          description: '检索类型',
          enum: ['case', 'statute', 'regulation', 'precedent']
        },
        jurisdiction: {
          type: 'string',
          description: '法域'
        },
        dateRange: {
          type: 'object',
          description: '日期范围',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            court: { type: 'string' },
            category: { type: 'string' }
          }
        }
      },
      required: ['query', 'searchType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              citation: { type: 'string' },
              summary: { type: 'string' },
              relevance: { type: 'number' },
              url: { type: 'string' }
            }
          }
        },
        total: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 建筑设计工具 (153-154)
  {
    id: 'tool_bim_modeler',
    name: 'bim_modeler',
    display_name: 'BIM建模器',
    description: '建筑信息模型创建与编辑',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'import', 'export', 'modify', 'analyze']
        },
        modelPath: {
          type: 'string',
          description: 'BIM模型路径'
        },
        format: {
          type: 'string',
          description: '模型格式',
          enum: ['ifc', 'rvt', 'dwg', 'obj']
        },
        elements: {
          type: 'array',
          description: '建筑元素',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              properties: { type: 'object' },
              geometry: { type: 'object' }
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        model: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            elements_count: { type: 'number' },
            metadata: { type: 'object' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read', 'file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_structure_analyzer',
    name: 'structure_analyzer',
    display_name: '结构分析器',
    description: '建筑结构力学分析,承载力计算',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        structure: {
          type: 'object',
          description: '结构模型',
          properties: {
            type: { type: 'string' },
            materials: { type: 'array' },
            dimensions: { type: 'object' }
          }
        },
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['static', 'dynamic', 'seismic', 'thermal', 'wind']
        },
        loads: {
          type: 'array',
          description: '荷载条件',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              magnitude: { type: 'number' },
              location: { type: 'object' }
            }
          }
        },
        standard: {
          type: 'string',
          description: '设计规范',
          enum: ['gb', 'eurocode', 'aisc', 'aci']
        }
      },
      required: ['structure', 'analysisType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'object',
          properties: {
            stress: { type: 'array' },
            displacement: { type: 'array' },
            safety_factor: { type: 'number' },
            critical_points: { type: 'array' }
          }
        },
        compliance: { type: 'boolean' },
        recommendations: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 电子商务工具 (155-156)
  {
    id: 'tool_recommendation_engine',
    name: 'recommendation_engine',
    display_name: '推荐引擎',
    description: '个性化推荐,协同过滤/内容推荐',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: '用户ID'
        },
        algorithm: {
          type: 'string',
          description: '推荐算法',
          enum: ['collaborative', 'content_based', 'hybrid', 'matrix_factorization']
        },
        context: {
          type: 'object',
          description: '上下文信息',
          properties: {
            location: { type: 'string' },
            time: { type: 'string' },
            device: { type: 'string' }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            categories: { type: 'array' },
            price_range: { type: 'object' },
            in_stock: { type: 'boolean' }
          }
        },
        limit: {
          type: 'number',
          description: '推荐数量'
        }
      },
      required: ['userId', 'algorithm']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item_id: { type: 'string' },
              score: { type: 'number' },
              reason: { type: 'string' },
              metadata: { type: 'object' }
            }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_inventory_manager',
    name: 'inventory_manager',
    display_name: '库存管理器',
    description: '库存优化,需求预测,补货策略',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['forecast', 'optimize', 'reorder', 'analyze']
        },
        inventory: {
          type: 'array',
          description: '库存数据',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'number' },
              cost: { type: 'number' },
              sales_history: { type: 'array' }
            }
          }
        },
        parameters: {
          type: 'object',
          description: '管理参数',
          properties: {
            lead_time: { type: 'number' },
            service_level: { type: 'number' },
            holding_cost: { type: 'number' }
          }
        },
        forecast_horizon: {
          type: 'number',
          description: '预测周期(天)'
        }
      },
      required: ['action', 'inventory']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        result: {
          type: 'object',
          properties: {
            forecast: { type: 'array' },
            reorder_points: { type: 'object' },
            order_quantities: { type: 'object' },
            stockout_risk: { type: 'number' }
          }
        },
        recommendations: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // =============== 第八批工具扩展 (157-176) ===============

  // 云计算DevOps工具 (157-158)
  {
    id: 'tool_container_orchestrator',
    name: 'container_orchestrator',
    display_name: '容器编排器',
    description: 'Kubernetes/Docker Swarm容器编排管理',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['deploy', 'scale', 'update', 'delete', 'status']
        },
        service: {
          type: 'object',
          description: '服务配置',
          properties: {
            name: { type: 'string' },
            image: { type: 'string' },
            replicas: { type: 'number' },
            ports: { type: 'array' },
            env: { type: 'object' }
          }
        },
        namespace: {
          type: 'string',
          description: '命名空间'
        },
        cluster: {
          type: 'string',
          description: '集群名称'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        deployment: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            status: { type: 'string' },
            replicas: { type: 'number' },
            ready: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_cicd_pipeline',
    name: 'cicd_pipeline',
    display_name: 'CI/CD流水线',
    description: '持续集成/持续部署流水线管理',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'trigger', 'status', 'cancel']
        },
        pipeline: {
          type: 'object',
          description: '流水线配置',
          properties: {
            name: { type: 'string' },
            stages: { type: 'array' },
            triggers: { type: 'array' }
          }
        },
        repository: {
          type: 'string',
          description: '代码仓库'
        },
        branch: {
          type: 'string',
          description: '分支名称'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pipeline_run: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string' },
            stages: { type: 'array' },
            duration: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['cicd.execute'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 量子计算工具 (159-160)
  {
    id: 'tool_quantum_circuit_builder',
    name: 'quantum_circuit_builder',
    display_name: '量子电路构建器',
    description: '构建和编辑量子电路',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        num_qubits: {
          type: 'number',
          description: '量子比特数量'
        },
        gates: {
          type: 'array',
          description: '量子门列表',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              target: { type: 'number' },
              control: { type: 'number' },
              angle: { type: 'number' }
            }
          }
        },
        measurements: {
          type: 'array',
          description: '测量配置'
        }
      },
      required: ['num_qubits']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        circuit: {
          type: 'object',
          properties: {
            qubits: { type: 'number' },
            depth: { type: 'number' },
            gates: { type: 'array' },
            qasm: { type: 'string' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_quantum_simulator',
    name: 'quantum_simulator',
    display_name: '量子模拟器',
    description: '模拟量子电路执行',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        circuit: {
          type: 'object',
          description: '量子电路'
        },
        shots: {
          type: 'number',
          description: '测量次数'
        },
        backend: {
          type: 'string',
          description: '模拟后端',
          enum: ['statevector', 'qasm', 'unitary']
        },
        noise_model: {
          type: 'object',
          description: '噪声模型'
        }
      },
      required: ['circuit']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'object',
          properties: {
            counts: { type: 'object' },
            statevector: { type: 'array' },
            probabilities: { type: 'object' }
          }
        },
        execution_time: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // AR/VR工具 (161-162)
  {
    id: 'tool_ar_content_creator',
    name: 'ar_content_creator',
    display_name: 'AR内容创建器',
    description: '创建AR场景、标记、交互元素',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        contentType: {
          type: 'string',
          description: '内容类型',
          enum: ['marker', 'markerless', 'location_based', 'face_filter']
        },
        assets: {
          type: 'array',
          description: '3D资产列表',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              url: { type: 'string' },
              position: { type: 'array' },
              scale: { type: 'array' }
            }
          }
        },
        interactions: {
          type: 'array',
          description: '交互配置'
        },
        tracking: {
          type: 'object',
          description: '跟踪配置'
        }
      },
      required: ['contentType', 'assets']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        scene: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string' },
            preview: { type: 'string' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_vr_scene_builder',
    name: 'vr_scene_builder',
    display_name: 'VR场景构建器',
    description: '构建VR虚拟场景',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        environment: {
          type: 'object',
          description: '环境设置',
          properties: {
            skybox: { type: 'string' },
            lighting: { type: 'object' },
            fog: { type: 'object' }
          }
        },
        objects: {
          type: 'array',
          description: '场景对象',
          items: {
            type: 'object',
            properties: {
              model: { type: 'string' },
              position: { type: 'array' },
              rotation: { type: 'array' },
              physics: { type: 'object' }
            }
          }
        },
        navigation: {
          type: 'object',
          description: '导航配置',
          properties: {
            type: { type: 'string' },
            speed: { type: 'number' }
          }
        }
      },
      required: ['environment']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        scene: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string' },
            assets: { type: 'array' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 语音合成工具 (163-164)
  {
    id: 'tool_text_to_speech',
    name: 'text_to_speech',
    display_name: '文字转语音',
    description: '将文本转换为自然语音',
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
          description: '语言',
          enum: ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR']
        },
        voice: {
          type: 'string',
          description: '音色',
          enum: ['male', 'female', 'child']
        },
        options: {
          type: 'object',
          description: '语音选项',
          properties: {
            speed: { type: 'number' },
            pitch: { type: 'number' },
            volume: { type: 'number' },
            emotion: { type: 'string' }
          }
        },
        outputFormat: {
          type: 'string',
          description: '输出格式',
          enum: ['mp3', 'wav', 'ogg']
        }
      },
      required: ['text', 'language']
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
    required_permissions: ['file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_voice_cloner',
    name: 'voice_cloner',
    display_name: '语音克隆器',
    description: '克隆特定人声进行语音合成',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['train', 'synthesize', 'evaluate']
        },
        reference_audio: {
          type: 'string',
          description: '参考音频路径'
        },
        text: {
          type: 'string',
          description: '要合成的文本'
        },
        model_id: {
          type: 'string',
          description: '已训练模型ID'
        },
        training_duration: {
          type: 'number',
          description: '训练时长(分钟)'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        model_id: { type: 'string' },
        audioPath: { type: 'string' },
        similarity_score: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read', 'file.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 计算机视觉工具 (165-166)
  {
    id: 'tool_object_detector',
    name: 'object_detector',
    display_name: '目标检测器',
    description: '检测图像中的物体',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '图像文件路径'
        },
        model: {
          type: 'string',
          description: '检测模型',
          enum: ['yolo', 'faster_rcnn', 'ssd', 'retinanet']
        },
        classes: {
          type: 'array',
          description: '要检测的类别',
          items: { type: 'string' }
        },
        confidence_threshold: {
          type: 'number',
          description: '置信度阈值'
        },
        nms_threshold: {
          type: 'number',
          description: '非极大值抑制阈值'
        }
      },
      required: ['imagePath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        detections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              class: { type: 'string' },
              confidence: { type: 'number' },
              bbox: { type: 'array' }
            }
          }
        },
        annotated_image: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_image_segmenter',
    name: 'image_segmenter',
    display_name: '图像分割器',
    description: '对图像进行语义/实例分割',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: '图像文件路径'
        },
        segmentationType: {
          type: 'string',
          description: '分割类型',
          enum: ['semantic', 'instance', 'panoptic']
        },
        model: {
          type: 'string',
          description: '分割模型',
          enum: ['unet', 'mask_rcnn', 'deeplab']
        },
        classes: {
          type: 'array',
          description: '分割类别'
        }
      },
      required: ['imagePath', 'segmentationType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        masks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              class: { type: 'string' },
              mask: { type: 'array' },
              area: { type: 'number' }
            }
          }
        },
        visualization: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read', 'file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 自动化测试工具 (167-168)
  {
    id: 'tool_test_generator',
    name: 'test_generator',
    display_name: '测试用例生成器',
    description: '自动生成单元测试/集成测试代码',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: '源代码路径'
        },
        testType: {
          type: 'string',
          description: '测试类型',
          enum: ['unit', 'integration', 'e2e', 'snapshot']
        },
        framework: {
          type: 'string',
          description: '测试框架',
          enum: ['jest', 'mocha', 'jasmine', 'pytest', 'junit']
        },
        coverage_target: {
          type: 'number',
          description: '目标覆盖率'
        },
        mocking: {
          type: 'boolean',
          description: '是否生成mock'
        }
      },
      required: ['sourcePath', 'testType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        testFiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              tests_count: { type: 'number' }
            }
          }
        },
        estimated_coverage: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read', 'file.write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_test_runner',
    name: 'test_runner',
    display_name: '测试执行器',
    description: '执行测试套件并生成报告',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        testPath: {
          type: 'string',
          description: '测试路径'
        },
        framework: {
          type: 'string',
          description: '测试框架'
        },
        options: {
          type: 'object',
          description: '运行选项',
          properties: {
            parallel: { type: 'boolean' },
            coverage: { type: 'boolean' },
            watch: { type: 'boolean' },
            timeout: { type: 'number' }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            pattern: { type: 'string' },
            tags: { type: 'array' }
          }
        }
      },
      required: ['testPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            passed: { type: 'number' },
            failed: { type: 'number' },
            skipped: { type: 'number' },
            duration: { type: 'number' }
          }
        },
        coverage: { type: 'object' },
        report_path: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 内容管理工具 (169-170)
  {
    id: 'tool_content_publisher',
    name: 'content_publisher',
    display_name: '内容发布器',
    description: '内容发布与版本管理',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'update', 'publish', 'unpublish', 'delete']
        },
        content: {
          type: 'object',
          description: '内容数据',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            body: { type: 'string' },
            author: { type: 'string' },
            tags: { type: 'array' },
            metadata: { type: 'object' }
          }
        },
        workflow: {
          type: 'object',
          description: '工作流配置',
          properties: {
            approval_required: { type: 'boolean' },
            reviewers: { type: 'array' }
          }
        },
        schedule: {
          type: 'object',
          description: '发布计划',
          properties: {
            publish_at: { type: 'string' },
            expire_at: { type: 'string' }
          }
        }
      },
      required: ['action', 'content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        content_id: { type: 'string' },
        status: { type: 'string' },
        version: { type: 'number' },
        url: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['content.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_media_manager',
    name: 'media_manager',
    display_name: '媒体管理器',
    description: '媒体文件上传、转码、CDN分发',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['upload', 'transcode', 'delete', 'get_url']
        },
        file: {
          type: 'object',
          description: '文件信息',
          properties: {
            path: { type: 'string' },
            type: { type: 'string' },
            size: { type: 'number' }
          }
        },
        transcode_options: {
          type: 'object',
          description: '转码选项',
          properties: {
            format: { type: 'string' },
            quality: { type: 'string' },
            resolution: { type: 'string' }
          }
        },
        cdn: {
          type: 'object',
          description: 'CDN配置',
          properties: {
            enabled: { type: 'boolean' },
            cache_ttl: { type: 'number' }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        file_id: { type: 'string' },
        url: { type: 'string' },
        cdn_url: { type: 'string' },
        metadata: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['file.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  // 社交媒体分析工具 (171-172)
  {
    id: 'tool_sentiment_monitor',
    name: 'sentiment_monitor',
    display_name: '舆情监控器',
    description: '监控社交媒体情感倾向',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          description: '关键词列表',
          items: { type: 'string' }
        },
        platforms: {
          type: 'array',
          description: '平台列表',
          items: {
            type: 'string',
            enum: ['twitter', 'weibo', 'facebook', 'reddit']
          }
        },
        timeRange: {
          type: 'object',
          description: '时间范围',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' }
          }
        },
        language: {
          type: 'string',
          description: '语言过滤'
        }
      },
      required: ['keywords', 'platforms']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        sentiment: {
          type: 'object',
          properties: {
            positive: { type: 'number' },
            neutral: { type: 'number' },
            negative: { type: 'number' }
          }
        },
        trends: { type: 'array' },
        top_posts: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_influencer_analyzer',
    name: 'influencer_analyzer',
    display_name: '影响力分析器',
    description: '分析用户/账号影响力',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: '用户ID/用户名'
        },
        platform: {
          type: 'string',
          description: '平台',
          enum: ['twitter', 'weibo', 'instagram', 'youtube']
        },
        metrics: {
          type: 'array',
          description: '分析指标',
          items: {
            type: 'string',
            enum: ['reach', 'engagement', 'growth', 'authenticity']
          }
        },
        period: {
          type: 'number',
          description: '分析周期(天)'
        }
      },
      required: ['user_id', 'platform']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        profile: {
          type: 'object',
          properties: {
            followers: { type: 'number' },
            engagement_rate: { type: 'number' },
            influence_score: { type: 'number' }
          }
        },
        audience_demographics: { type: 'object' },
        content_analysis: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 供应链管理工具 (173-174)
  {
    id: 'tool_logistics_optimizer',
    name: 'logistics_optimizer',
    display_name: '物流优化器',
    description: '优化配送路线和资源分配',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        problem_type: {
          type: 'string',
          description: '问题类型',
          enum: ['vehicle_routing', 'facility_location', 'network_design']
        },
        locations: {
          type: 'array',
          description: '位置列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              lat: { type: 'number' },
              lon: { type: 'number' },
              demand: { type: 'number' }
            }
          }
        },
        vehicles: {
          type: 'array',
          description: '车辆配置'
        },
        constraints: {
          type: 'object',
          description: '约束条件',
          properties: {
            max_distance: { type: 'number' },
            time_windows: { type: 'array' },
            capacity: { type: 'number' }
          }
        },
        optimization_goal: {
          type: 'string',
          description: '优化目标',
          enum: ['minimize_cost', 'minimize_time', 'minimize_distance']
        }
      },
      required: ['problem_type', 'locations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        solution: {
          type: 'object',
          properties: {
            routes: { type: 'array' },
            total_cost: { type: 'number' },
            total_distance: { type: 'number' },
            vehicles_used: { type: 'number' }
          }
        },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_demand_forecaster',
    name: 'demand_forecaster',
    display_name: '需求预测器',
    description: '预测产品需求和市场趋势',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        historical_data: {
          type: 'array',
          description: '历史数据',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              value: { type: 'number' }
            }
          }
        },
        forecast_horizon: {
          type: 'number',
          description: '预测周期(天)'
        },
        model: {
          type: 'string',
          description: '预测模型',
          enum: ['arima', 'prophet', 'lstm', 'exponential_smoothing']
        },
        external_factors: {
          type: 'array',
          description: '外部因素',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              values: { type: 'array' }
            }
          }
        }
      },
      required: ['historical_data', 'forecast_horizon']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        forecast: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string' },
              predicted: { type: 'number' },
              lower_bound: { type: 'number' },
              upper_bound: { type: 'number' }
            }
          }
        },
        accuracy_metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // 环境科学工具 (175-176)
  {
    id: 'tool_weather_analyzer',
    name: 'weather_analyzer',
    display_name: '气象分析器',
    description: '分析气象数据和天气模式',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'object',
          description: '位置',
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' }
          }
        },
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['current', 'forecast', 'historical', 'anomaly']
        },
        timeRange: {
          type: 'object',
          description: '时间范围',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' }
          }
        },
        parameters: {
          type: 'array',
          description: '气象参数',
          items: {
            type: 'string',
            enum: ['temperature', 'humidity', 'precipitation', 'wind', 'pressure']
          }
        }
      },
      required: ['location', 'analysisType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        weather_data: {
          type: 'object',
          properties: {
            current: { type: 'object' },
            forecast: { type: 'array' },
            statistics: { type: 'object' }
          }
        },
        anomalies: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_pollution_predictor',
    name: 'pollution_predictor',
    display_name: '污染预测器',
    description: '预测空气/水污染水平',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'object',
          description: '位置'
        },
        pollutionType: {
          type: 'string',
          description: '污染类型',
          enum: ['air', 'water', 'soil', 'noise']
        },
        pollutants: {
          type: 'array',
          description: '污染物列表',
          items: {
            type: 'string',
            enum: ['pm25', 'pm10', 'co2', 'no2', 'so2', 'o3']
          }
        },
        forecast_hours: {
          type: 'number',
          description: '预测小时数'
        },
        historical_data: {
          type: 'array',
          description: '历史监测数据'
        }
      },
      required: ['location', 'pollutionType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        current: {
          type: 'object',
          properties: {
            aqi: { type: 'number' },
            level: { type: 'string' },
            primary_pollutant: { type: 'string' }
          }
        },
        forecast: { type: 'array' },
        health_impact: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // ==================== 第九批工具 (177-196) ====================

  {
    id: 'tool_iot_device_manager',
    name: 'iot_device_manager',
    display_name: 'IoT设备管理器',
    description: '管理IoT设备的注册、配置、监控和控制',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['register', 'configure', 'control', 'query', 'remove']
        },
        device: {
          type: 'object',
          description: '设备信息',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' },
            protocol: { type: 'string', enum: ['mqtt', 'coap', 'http'] }
          }
        },
        command: {
          type: 'object',
          description: '控制命令'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        device: { type: 'object' },
        devices: { type: 'array' },
        status: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_mqtt_broker',
    name: 'mqtt_broker',
    display_name: 'MQTT消息代理',
    description: 'MQTT消息发布订阅、主题管理、QoS控制',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['publish', 'subscribe', 'unsubscribe', 'status']
        },
        topic: {
          type: 'string',
          description: 'MQTT主题'
        },
        message: {
          type: 'object',
          description: '消息内容'
        },
        qos: {
          type: 'number',
          description: '服务质量等级',
          enum: [0, 1, 2],
          default: 0
        },
        retain: {
          type: 'boolean',
          description: '是否保留消息',
          default: false
        }
      },
      required: ['action', 'topic']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message_id: { type: 'string' },
        subscriptions: { type: 'array' },
        messages: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.mqtt'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_edge_node_manager',
    name: 'edge_node_manager',
    display_name: '边缘节点管理器',
    description: '管理边缘计算节点的部署、监控和资源调度',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['deploy', 'monitor', 'scale', 'update', 'remove']
        },
        node: {
          type: 'object',
          description: '节点信息',
          properties: {
            id: { type: 'string' },
            location: { type: 'string' },
            resources: { type: 'object' }
          }
        },
        workload: {
          type: 'object',
          description: '工作负载配置'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        node: { type: 'object' },
        nodes: { type: 'array' },
        metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_edge_inferencer',
    name: 'edge_inferencer',
    display_name: '边缘推理引擎',
    description: '在边缘设备上执行AI模型推理',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: '模型路径或ID'
        },
        input_data: {
          type: 'object',
          description: '输入数据'
        },
        format: {
          type: 'string',
          description: '模型格式',
          enum: ['onnx', 'tflite', 'pytorch', 'tensorrt']
        },
        device: {
          type: 'string',
          description: '推理设备',
          enum: ['cpu', 'gpu', 'npu', 'tpu'],
          default: 'cpu'
        }
      },
      required: ['model', 'input_data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        predictions: { type: 'array' },
        latency_ms: { type: 'number' },
        confidence: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_twin_model_builder',
    name: 'twin_model_builder',
    display_name: '数字孪生模型构建器',
    description: '构建物理实体的数字孪生模型',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        entity: {
          type: 'object',
          description: '物理实体信息',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            name: { type: 'string' }
          }
        },
        sensors: {
          type: 'array',
          description: '传感器配置'
        },
        parameters: {
          type: 'object',
          description: '模型参数'
        },
        physics_model: {
          type: 'string',
          description: '物理模型类型',
          enum: ['kinematic', 'dynamic', 'thermal', 'fluid']
        }
      },
      required: ['entity']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        twin_id: { type: 'string' },
        model: { type: 'object' },
        visualization_url: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_twin_simulator',
    name: 'twin_simulator',
    display_name: '数字孪生仿真器',
    description: '运行数字孪生仿真和预测分析',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        twin_id: {
          type: 'string',
          description: '孪生体ID'
        },
        simulation_type: {
          type: 'string',
          description: '仿真类型',
          enum: ['real_time', 'predictive', 'what_if', 'optimization']
        },
        scenario: {
          type: 'object',
          description: '仿真场景配置'
        },
        time_horizon: {
          type: 'number',
          description: '仿真时长(秒)'
        }
      },
      required: ['twin_id', 'simulation_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: { type: 'object' },
        predictions: { type: 'array' },
        anomalies: { type: 'array' },
        metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_plc_controller',
    name: 'plc_controller',
    display_name: 'PLC控制器',
    description: 'PLC设备编程、监控和控制',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['read', 'write', 'program', 'monitor', 'diagnose']
        },
        plc: {
          type: 'object',
          description: 'PLC设备信息',
          properties: {
            ip: { type: 'string' },
            type: { type: 'string', enum: ['siemens', 'allen_bradley', 'mitsubishi'] },
            protocol: { type: 'string', enum: ['modbus', 's7', 'ethernet_ip'] }
          }
        },
        address: {
          type: 'string',
          description: '寄存器地址'
        },
        value: {
          type: 'object',
          description: '写入值'
        }
      },
      required: ['action', 'plc']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        status: { type: 'string' },
        diagnostics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_production_scheduler',
    name: 'production_scheduler',
    display_name: '生产调度器',
    description: '生产计划优化和资源调度',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          description: '生产订单列表'
        },
        resources: {
          type: 'object',
          description: '可用资源(设备、人员、材料)'
        },
        constraints: {
          type: 'object',
          description: '约束条件'
        },
        optimization_goal: {
          type: 'string',
          description: '优化目标',
          enum: ['minimize_time', 'minimize_cost', 'maximize_throughput', 'balance_load']
        }
      },
      required: ['orders', 'resources']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        schedule: { type: 'array' },
        gantt_chart: { type: 'object' },
        metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_scene_automator',
    name: 'scene_automator',
    display_name: '场景自动化器',
    description: '智能家居场景自动化配置和执行',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'execute', 'update', 'delete', 'list']
        },
        scene: {
          type: 'object',
          description: '场景配置',
          properties: {
            name: { type: 'string' },
            triggers: { type: 'array' },
            conditions: { type: 'array' },
            actions: { type: 'array' }
          }
        },
        scene_id: {
          type: 'string',
          description: '场景ID'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        scene_id: { type: 'string' },
        scenes: { type: 'array' },
        execution_result: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_device_linker',
    name: 'device_linker',
    display_name: '设备联动器',
    description: '智能设备之间的联动规则配置',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        linkage: {
          type: 'object',
          description: '联动规则',
          properties: {
            name: { type: 'string' },
            source_device: { type: 'string' },
            source_event: { type: 'string' },
            target_devices: { type: 'array' },
            target_actions: { type: 'array' }
          }
        },
        enabled: {
          type: 'boolean',
          description: '是否启用',
          default: true
        }
      },
      required: ['linkage']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        linkage_id: { type: 'string' },
        linkages: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_crop_monitor',
    name: 'crop_monitor',
    display_name: '作物监测器',
    description: '作物生长监测、病虫害识别、产量预测',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'object',
          description: '农田信息',
          properties: {
            id: { type: 'string' },
            location: { type: 'object' },
            crop_type: { type: 'string' }
          }
        },
        monitoring_type: {
          type: 'string',
          description: '监测类型',
          enum: ['growth', 'disease', 'pest', 'yield', 'nutrition']
        },
        images: {
          type: 'array',
          description: '监测图像'
        },
        sensor_data: {
          type: 'object',
          description: '传感器数据'
        }
      },
      required: ['field', 'monitoring_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        status: { type: 'string' },
        detections: { type: 'array' },
        recommendations: { type: 'array' },
        yield_forecast: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_irrigation_controller',
    name: 'irrigation_controller',
    display_name: '灌溉控制器',
    description: '智能灌溉系统控制和优化',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['start', 'stop', 'schedule', 'optimize', 'status']
        },
        zone: {
          type: 'object',
          description: '灌溉区域'
        },
        parameters: {
          type: 'object',
          description: '灌溉参数',
          properties: {
            duration: { type: 'number' },
            flow_rate: { type: 'number' },
            schedule: { type: 'array' }
          }
        },
        soil_moisture: {
          type: 'number',
          description: '土壤湿度'
        },
        weather_forecast: {
          type: 'object',
          description: '天气预报'
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        status: { type: 'string' },
        schedule: { type: 'array' },
        water_usage: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_traffic_controller',
    name: 'traffic_controller',
    display_name: '交通控制器',
    description: '智能交通信号控制和流量优化',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        intersection: {
          type: 'object',
          description: '路口信息'
        },
        mode: {
          type: 'string',
          description: '控制模式',
          enum: ['fixed', 'adaptive', 'coordinated', 'emergency']
        },
        traffic_data: {
          type: 'object',
          description: '实时交通数据'
        },
        optimization_goal: {
          type: 'string',
          description: '优化目标',
          enum: ['minimize_delay', 'maximize_throughput', 'balance_load']
        }
      },
      required: ['intersection', 'mode']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        signal_plan: { type: 'object' },
        metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_public_safety_monitor',
    name: 'public_safety_monitor',
    display_name: '公共安全监控器',
    description: '公共安全事件监测和应急响应',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        area: {
          type: 'object',
          description: '监控区域'
        },
        monitoring_types: {
          type: 'array',
          description: '监控类型',
          items: {
            type: 'string',
            enum: ['video', 'audio', 'sensor', 'social_media']
          }
        },
        alert_rules: {
          type: 'array',
          description: '告警规则'
        },
        video_streams: {
          type: 'array',
          description: '视频流'
        }
      },
      required: ['area']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        events: { type: 'array' },
        alerts: { type: 'array' },
        threat_level: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_orbit_calculator',
    name: 'orbit_calculator',
    display_name: '轨道计算器',
    description: '卫星/航天器轨道计算和预测',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        calculation_type: {
          type: 'string',
          description: '计算类型',
          enum: ['propagation', 'maneuver', 'rendezvous', 'reentry']
        },
        orbital_elements: {
          type: 'object',
          description: '轨道根数',
          properties: {
            a: { type: 'number', description: '半长轴(km)' },
            e: { type: 'number', description: '偏心率' },
            i: { type: 'number', description: '轨道倾角(度)' },
            omega: { type: 'number', description: '升交点赤经(度)' },
            w: { type: 'number', description: '近地点幅角(度)' },
            M: { type: 'number', description: '平近点角(度)' }
          }
        },
        time_span: {
          type: 'number',
          description: '时间跨度(秒)'
        },
        perturbations: {
          type: 'array',
          description: '摄动项',
          items: {
            type: 'string',
            enum: ['j2', 'drag', 'sun', 'moon', 'srp']
          }
        }
      },
      required: ['calculation_type', 'orbital_elements']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        trajectory: { type: 'array' },
        future_elements: { type: 'object' },
        ground_track: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_flight_planner',
    name: 'flight_planner',
    display_name: '飞行规划器',
    description: '航空飞行路径规划和优化',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        departure: {
          type: 'object',
          description: '起飞点',
          properties: {
            airport: { type: 'string' },
            coordinates: { type: 'object' },
            time: { type: 'string' }
          }
        },
        destination: {
          type: 'object',
          description: '目的地'
        },
        aircraft: {
          type: 'object',
          description: '飞机信息',
          properties: {
            type: { type: 'string' },
            cruise_speed: { type: 'number' },
            range: { type: 'number' }
          }
        },
        optimization: {
          type: 'string',
          description: '优化目标',
          enum: ['shortest', 'fastest', 'fuel_efficient', 'weather_avoid']
        },
        weather_data: {
          type: 'object',
          description: '气象数据'
        }
      },
      required: ['departure', 'destination', 'aircraft']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        route: { type: 'array' },
        waypoints: { type: 'array' },
        flight_plan: { type: 'object' },
        estimates: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_ocean_monitor',
    name: 'ocean_monitor',
    display_name: '海洋监测器',
    description: '海洋环境监测和海洋生态分析',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        area: {
          type: 'object',
          description: '监测区域',
          properties: {
            coordinates: { type: 'array' },
            depth_range: { type: 'object' }
          }
        },
        monitoring_type: {
          type: 'string',
          description: '监测类型',
          enum: ['temperature', 'salinity', 'current', 'wave', 'biology', 'pollution']
        },
        data_sources: {
          type: 'array',
          description: '数据源',
          items: {
            type: 'string',
            enum: ['buoy', 'satellite', 'ship', 'underwater_vehicle']
          }
        },
        time_range: {
          type: 'object',
          description: '时间范围'
        }
      },
      required: ['area', 'monitoring_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        measurements: { type: 'array' },
        analysis: { type: 'object' },
        visualization: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['network.request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_navigation_planner',
    name: 'navigation_planner',
    display_name: '航海规划器',
    description: '船舶航海路径规划和优化',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        departure: {
          type: 'object',
          description: '起点港口'
        },
        destination: {
          type: 'object',
          description: '目的港口'
        },
        vessel: {
          type: 'object',
          description: '船舶信息',
          properties: {
            type: { type: 'string' },
            draft: { type: 'number' },
            speed: { type: 'number' }
          }
        },
        optimization: {
          type: 'string',
          description: '优化目标',
          enum: ['shortest', 'fastest', 'fuel_efficient', 'weather_routing']
        },
        constraints: {
          type: 'object',
          description: '约束条件'
        }
      },
      required: ['departure', 'destination', 'vessel']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        route: { type: 'array' },
        waypoints: { type: 'array' },
        eta: { type: 'string' },
        distance: { type: 'number' },
        fuel_estimate: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_power_dispatcher',
    name: 'power_dispatcher',
    display_name: '电力调度器',
    description: '电力系统调度和负荷平衡',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        grid: {
          type: 'object',
          description: '电网信息'
        },
        generators: {
          type: 'array',
          description: '发电机组列表'
        },
        load_forecast: {
          type: 'object',
          description: '负荷预测'
        },
        optimization: {
          type: 'string',
          description: '优化目标',
          enum: ['minimize_cost', 'maximize_reliability', 'minimize_emissions']
        },
        constraints: {
          type: 'object',
          description: '约束条件'
        }
      },
      required: ['grid', 'generators']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        dispatch_plan: { type: 'array' },
        total_cost: { type: 'number' },
        emissions: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_renewable_forecaster',
    name: 'renewable_forecaster',
    display_name: '新能源预测器',
    description: '太阳能、风能等可再生能源发电预测',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        energy_type: {
          type: 'string',
          description: '能源类型',
          enum: ['solar', 'wind', 'hydro', 'geothermal']
        },
        location: {
          type: 'object',
          description: '位置信息'
        },
        capacity: {
          type: 'number',
          description: '装机容量(MW)'
        },
        forecast_horizon: {
          type: 'number',
          description: '预测时长(小时)'
        },
        historical_data: {
          type: 'array',
          description: '历史数据'
        },
        weather_forecast: {
          type: 'object',
          description: '天气预报'
        }
      },
      required: ['energy_type', 'location', 'capacity']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        forecast: { type: 'array' },
        confidence_intervals: { type: 'array' },
        total_generation: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  // ==================== 第十批工具 (197-216) ====================

  {
    id: 'tool_quantum_key_distributor',
    name: 'quantum_key_distributor',
    display_name: '量子密钥分发器',
    description: 'BB84/E91协议量子密钥分发',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        protocol: {
          type: 'string',
          description: 'QKD协议',
          enum: ['BB84', 'E91', 'B92', 'SARG04']
        },
        key_length: {
          type: 'number',
          description: '密钥长度(bits)'
        },
        channel: {
          type: 'object',
          description: '量子信道参数',
          properties: {
            distance: { type: 'number' },
            loss_db: { type: 'number' },
            noise: { type: 'number' }
          }
        },
        error_correction: {
          type: 'boolean',
          description: '是否纠错',
          default: true
        }
      },
      required: ['protocol', 'key_length']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        key: { type: 'string' },
        qber: { type: 'number' },
        secure: { type: 'boolean' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['security.encryption'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_quantum_teleporter',
    name: 'quantum_teleporter',
    display_name: '量子隐形传态器',
    description: '量子态传输和量子纠缠操作',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        quantum_state: {
          type: 'object',
          description: '待传输的量子态',
          properties: {
            alpha: { type: 'number' },
            beta: { type: 'number' }
          }
        },
        entanglement_quality: {
          type: 'number',
          description: '纠缠质量(0-1)'
        },
        classical_channel: {
          type: 'object',
          description: '经典信道参数'
        }
      },
      required: ['quantum_state']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        fidelity: { type: 'number' },
        measurement_results: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_eeg_processor',
    name: 'eeg_processor',
    display_name: '脑电信号处理器',
    description: 'EEG信号滤波、特征提取、伪迹去除',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        eeg_data: {
          type: 'array',
          description: 'EEG原始数据'
        },
        sampling_rate: {
          type: 'number',
          description: '采样率(Hz)'
        },
        channels: {
          type: 'array',
          description: '通道列表'
        },
        processing: {
          type: 'object',
          description: '处理参数',
          properties: {
            filter: { type: 'string', enum: ['bandpass', 'notch', 'highpass'] },
            artifact_removal: { type: 'boolean' },
            feature_extraction: { type: 'array' }
          }
        }
      },
      required: ['eeg_data', 'sampling_rate']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        processed_data: { type: 'array' },
        features: { type: 'object' },
        quality_metrics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_bci_decoder',
    name: 'bci_decoder',
    display_name: '脑机接口解码器',
    description: '解码脑电信号识别用户意图',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        features: {
          type: 'object',
          description: 'EEG特征'
        },
        task_type: {
          type: 'string',
          description: '任务类型',
          enum: ['motor_imagery', 'p300', 'ssvep', 'error_potential']
        },
        model: {
          type: 'string',
          description: '解码模型',
          enum: ['lda', 'svm', 'cnn', 'rnn']
        },
        calibration_data: {
          type: 'array',
          description: '校准数据'
        }
      },
      required: ['features', 'task_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        intent: { type: 'string' },
        confidence: { type: 'number' },
        probabilities: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_gene_editor',
    name: 'gene_editor',
    display_name: '基因编辑器',
    description: 'CRISPR-Cas9基因编辑设计和模拟',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        target_gene: {
          type: 'string',
          description: '目标基因序列'
        },
        edit_type: {
          type: 'string',
          description: '编辑类型',
          enum: ['knockout', 'knockin', 'base_editing', 'prime_editing']
        },
        editor: {
          type: 'string',
          description: 'CRISPR系统',
          enum: ['Cas9', 'Cas12', 'Cas13', 'base_editor']
        },
        pam_sequence: {
          type: 'string',
          description: 'PAM序列'
        },
        grna_design: {
          type: 'object',
          description: 'gRNA设计参数'
        }
      },
      required: ['target_gene', 'edit_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        grna_sequences: { type: 'array' },
        off_targets: { type: 'array' },
        efficiency_score: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_protein_designer',
    name: 'protein_designer',
    display_name: '蛋白质设计器',
    description: 'De novo蛋白质设计和结构优化',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        design_goal: {
          type: 'string',
          description: '设计目标',
          enum: ['enzyme', 'antibody', 'scaffold', 'binder']
        },
        sequence: {
          type: 'string',
          description: '初始序列(可选)'
        },
        structure_constraints: {
          type: 'object',
          description: '结构约束'
        },
        function_requirements: {
          type: 'object',
          description: '功能要求',
          properties: {
            binding_target: { type: 'string' },
            catalytic_residues: { type: 'array' }
          }
        },
        optimization_cycles: {
          type: 'number',
          description: '优化轮数',
          default: 10
        }
      },
      required: ['design_goal']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        sequence: { type: 'string' },
        structure: { type: 'object' },
        stability_score: { type: 'number' },
        function_score: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_nano_simulator',
    name: 'nano_simulator',
    display_name: '纳米模拟器',
    description: '分子动力学和纳米材料模拟',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        system: {
          type: 'object',
          description: '模拟体系',
          properties: {
            atoms: { type: 'array' },
            lattice: { type: 'object' },
            temperature: { type: 'number' }
          }
        },
        method: {
          type: 'string',
          description: '模拟方法',
          enum: ['MD', 'MC', 'DFT', 'tight_binding']
        },
        simulation_time: {
          type: 'number',
          description: '模拟时长(ps)'
        },
        force_field: {
          type: 'string',
          description: '力场',
          enum: ['LAMMPS', 'AMBER', 'CHARMM', 'ReaxFF']
        }
      },
      required: ['system', 'method']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        trajectory: { type: 'array' },
        energy: { type: 'number' },
        properties: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_nano_fabricator',
    name: 'nano_fabricator',
    display_name: '纳米加工器',
    description: '纳米加工工艺设计和模拟',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        process: {
          type: 'string',
          description: '加工工艺',
          enum: ['lithography', 'etching', 'deposition', 'self_assembly']
        },
        pattern: {
          type: 'object',
          description: '图案设计'
        },
        materials: {
          type: 'array',
          description: '材料列表'
        },
        parameters: {
          type: 'object',
          description: '工艺参数',
          properties: {
            resolution: { type: 'number' },
            temperature: { type: 'number' },
            pressure: { type: 'number' }
          }
        }
      },
      required: ['process', 'pattern']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        fabrication_plan: { type: 'object' },
        yield_estimate: { type: 'number' },
        defects: { type: 'array' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_reactor_simulator',
    name: 'reactor_simulator',
    display_name: '反应堆模拟器',
    description: '核反应堆物理和热工水力模拟',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        reactor_type: {
          type: 'string',
          description: '反应堆类型',
          enum: ['PWR', 'BWR', 'CANDU', 'fast_reactor']
        },
        power_level: {
          type: 'number',
          description: '功率水平(MW)'
        },
        fuel_composition: {
          type: 'object',
          description: '燃料成分'
        },
        control_rods: {
          type: 'object',
          description: '控制棒位置'
        },
        simulation_type: {
          type: 'string',
          description: '模拟类型',
          enum: ['steady_state', 'transient', 'accident']
        }
      },
      required: ['reactor_type', 'power_level']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        keff: { type: 'number' },
        power_distribution: { type: 'array' },
        temperature_distribution: { type: 'array' },
        safety_parameters: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_radiation_monitor',
    name: 'radiation_monitor',
    display_name: '辐射监测器',
    description: '辐射剂量监测和核素分析',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        detector_type: {
          type: 'string',
          description: '探测器类型',
          enum: ['GM', 'scintillator', 'semiconductor', 'ionization_chamber']
        },
        measurement_type: {
          type: 'string',
          description: '测量类型',
          enum: ['dose_rate', 'contamination', 'spectroscopy']
        },
        location: {
          type: 'object',
          description: '监测位置'
        },
        background: {
          type: 'number',
          description: '本底值'
        }
      },
      required: ['detector_type', 'measurement_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        dose_rate: { type: 'number' },
        nuclides: { type: 'array' },
        alarm_level: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_underwater_navigator',
    name: 'underwater_navigator',
    display_name: '水下导航器',
    description: 'INS/DVL/USBL组合水下导航',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        navigation_mode: {
          type: 'string',
          description: '导航模式',
          enum: ['INS', 'DVL', 'USBL', 'integrated']
        },
        sensor_data: {
          type: 'object',
          description: '传感器数据',
          properties: {
            imu: { type: 'object' },
            dvl: { type: 'object' },
            depth: { type: 'number' }
          }
        },
        initial_position: {
          type: 'object',
          description: '初始位置'
        },
        current: {
          type: 'object',
          description: '海流信息'
        }
      },
      required: ['navigation_mode', 'sensor_data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        position: { type: 'object' },
        velocity: { type: 'object' },
        accuracy: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_deep_sea_mapper',
    name: 'deep_sea_mapper',
    display_name: '深海测绘器',
    description: '多波束声呐深海地形测绘',
    category: 'data',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sonar_type: {
          type: 'string',
          description: '声呐类型',
          enum: ['multibeam', 'sidescan', 'synthetic_aperture']
        },
        survey_area: {
          type: 'object',
          description: '测量区域',
          properties: {
            bounds: { type: 'array' },
            depth_range: { type: 'object' }
          }
        },
        resolution: {
          type: 'number',
          description: '分辨率(m)'
        },
        raw_data: {
          type: 'array',
          description: '原始声呐数据'
        }
      },
      required: ['sonar_type', 'survey_area']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        bathymetry: { type: 'array' },
        features: { type: 'array' },
        coverage: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['data.read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_asteroid_analyzer',
    name: 'asteroid_analyzer',
    display_name: '小行星分析器',
    description: '小行星成分、轨道和资源评估',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        asteroid_id: {
          type: 'string',
          description: '小行星编号'
        },
        analysis_type: {
          type: 'string',
          description: '分析类型',
          enum: ['composition', 'orbit', 'resources', 'mining_feasibility']
        },
        spectral_data: {
          type: 'array',
          description: '光谱数据'
        },
        orbital_elements: {
          type: 'object',
          description: '轨道根数'
        }
      },
      required: ['asteroid_id', 'analysis_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        composition: { type: 'object' },
        resources: { type: 'object' },
        value_estimate: { type: 'number' },
        accessibility: { type: 'string' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_lunar_miner',
    name: 'lunar_miner',
    display_name: '月球采矿器',
    description: '月球资源开采规划和模拟',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        site: {
          type: 'object',
          description: '采矿位置',
          properties: {
            coordinates: { type: 'object' },
            terrain: { type: 'string' }
          }
        },
        target_resource: {
          type: 'string',
          description: '目标资源',
          enum: ['water_ice', 'helium3', 'rare_earth', 'regolith']
        },
        equipment: {
          type: 'array',
          description: '采矿设备'
        },
        extraction_method: {
          type: 'string',
          description: '提取方法',
          enum: ['excavation', 'heating', 'electrolysis']
        }
      },
      required: ['site', 'target_resource']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        mining_plan: { type: 'object' },
        yield_estimate: { type: 'number' },
        energy_required: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_cloud_seeder',
    name: 'cloud_seeder',
    display_name: '云播种器',
    description: '人工降雨云播种作业规划',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        operation_type: {
          type: 'string',
          description: '作业类型',
          enum: ['precipitation_enhancement', 'hail_suppression', 'fog_dispersal']
        },
        seeding_agent: {
          type: 'string',
          description: '催化剂',
          enum: ['silver_iodide', 'dry_ice', 'hygroscopic_salt']
        },
        target_area: {
          type: 'object',
          description: '作业区域'
        },
        weather_conditions: {
          type: 'object',
          description: '气象条件',
          properties: {
            cloud_type: { type: 'string' },
            temperature: { type: 'number' },
            humidity: { type: 'number' }
          }
        },
        aircraft: {
          type: 'object',
          description: '作业飞机'
        }
      },
      required: ['operation_type', 'seeding_agent', 'target_area']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        flight_plan: { type: 'object' },
        dosage: { type: 'number' },
        effectiveness_estimate: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_weather_modeler',
    name: 'weather_modeler',
    display_name: '天气建模器',
    description: '数值天气预报和气候模拟',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: '模式',
          enum: ['WRF', 'GFS', 'ECMWF', 'regional']
        },
        domain: {
          type: 'object',
          description: '模拟区域',
          properties: {
            bounds: { type: 'array' },
            resolution: { type: 'number' }
          }
        },
        initial_conditions: {
          type: 'object',
          description: '初始场'
        },
        forecast_hours: {
          type: 'number',
          description: '预报时效'
        },
        physics_options: {
          type: 'object',
          description: '物理方案'
        }
      },
      required: ['model', 'domain', 'forecast_hours']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        forecast: { type: 'object' },
        fields: { type: 'array' },
        uncertainty: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_material_designer',
    name: 'material_designer',
    display_name: '材料设计器',
    description: 'AI驱动的材料设计和优化',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        material_class: {
          type: 'string',
          description: '材料类别',
          enum: ['metal', 'ceramic', 'polymer', 'composite', 'semiconductor']
        },
        target_properties: {
          type: 'object',
          description: '目标性能',
          properties: {
            strength: { type: 'number' },
            conductivity: { type: 'number' },
            density: { type: 'number' }
          }
        },
        constraints: {
          type: 'object',
          description: '约束条件',
          properties: {
            elements: { type: 'array' },
            cost: { type: 'number' },
            toxicity: { type: 'string' }
          }
        },
        design_method: {
          type: 'string',
          description: '设计方法',
          enum: ['ML', 'DFT', 'empirical', 'hybrid']
        }
      },
      required: ['material_class', 'target_properties']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        compositions: { type: 'array' },
        predicted_properties: { type: 'object' },
        synthesis_route: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_property_predictor',
    name: 'property_predictor',
    display_name: '性能预测器',
    description: '材料性能预测和筛选',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        material: {
          type: 'object',
          description: '材料信息',
          properties: {
            composition: { type: 'string' },
            structure: { type: 'object' }
          }
        },
        properties: {
          type: 'array',
          description: '待预测性能',
          items: {
            type: 'string',
            enum: ['band_gap', 'formation_energy', 'elastic_modulus', 'thermal_conductivity']
          }
        },
        method: {
          type: 'string',
          description: '预测方法',
          enum: ['ML', 'DFT', 'MD', 'empirical']
        }
      },
      required: ['material', 'properties']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        predictions: { type: 'object' },
        confidence: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_snn_builder',
    name: 'snn_builder',
    display_name: '脉冲神经网络构建器',
    description: '构建和训练脉冲神经网络',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        architecture: {
          type: 'object',
          description: '网络架构',
          properties: {
            layers: { type: 'array' },
            neuron_model: { type: 'string', enum: ['LIF', 'Izhikevich', 'AdEx'] },
            topology: { type: 'string' }
          }
        },
        learning_rule: {
          type: 'string',
          description: '学习规则',
          enum: ['STDP', 'R-STDP', 'backprop', 'surrogate_gradient']
        },
        encoding: {
          type: 'string',
          description: '编码方式',
          enum: ['rate', 'temporal', 'population', 'burst']
        },
        training_data: {
          type: 'array',
          description: '训练数据'
        }
      },
      required: ['architecture']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        model_id: { type: 'string' },
        performance: { type: 'object' },
        spike_statistics: { type: 'object' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['ai.inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },

  {
    id: 'tool_neuromorphic_accelerator',
    name: 'neuromorphic_accelerator',
    display_name: '神经形态加速器',
    description: '神经形态硬件加速和部署',
    category: 'system',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        hardware: {
          type: 'string',
          description: '硬件平台',
          enum: ['Loihi', 'TrueNorth', 'SpiNNaker', 'BrainScaleS']
        },
        model: {
          type: 'object',
          description: 'SNN模型'
        },
        optimization: {
          type: 'object',
          description: '优化选项',
          properties: {
            power_mode: { type: 'string', enum: ['low', 'balanced', 'high'] },
            latency_target: { type: 'number' }
          }
        },
        input_data: {
          type: 'object',
          description: '输入数据'
        }
      },
      required: ['hardware', 'model']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        output: { type: 'object' },
        latency_ms: { type: 'number' },
        power_consumption: { type: 'number' },
        error: { type: 'string' }
      }
    },
    required_permissions: ['system.admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
];
