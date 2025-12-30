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
];
