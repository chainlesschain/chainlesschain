/**
 * 内置工具定义
 * 自动生成，请勿手动编辑
 */

const tools = [
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
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        content: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '读取文本配置文件',
        params: {
          filePath: './config/app.json',
          encoding: 'utf-8'
        }
      },
      {
        description: '读取日志文件最后1000行',
        params: {
          filePath: '/var/log/application.log',
          encoding: 'utf-8',
          lines: 1000
        }
      },
      {
        description: '读取二进制数据文件',
        params: {
          filePath: './data/binary.dat',
          encoding: 'binary'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        size: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '文件写入基础用法',
        params: {
          filePath: './data/sample.dat',
          content: '示例文本'
        }
      },
      {
        description: '文件写入高级用法',
        params: {
          filePath: './advanced_data/sample.dat',
          content: '更复杂的示例文本内容，用于测试高级功能'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        html: {
          type: 'string'
        },
        fileName: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'HTML生成器基础用法',
        params: {
          title: '我的网页',
          content: '示例文本',
          primaryColor: '#667eea'
        }
      },
      {
        description: 'HTML生成器高级用法',
        params: {
          title: '我的网页',
          content: '更复杂的示例文本内容，用于测试高级功能',
          primaryColor: '#667eea'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        css: {
          type: 'string'
        },
        fileName: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'CSS生成器基础用法',
        params: {
          primaryColor: '#667eea',
          fontSize: '16px'
        }
      },
      {
        description: 'CSS生成器高级用法',
        params: {
          primaryColor: '#667eea',
          fontSize: '16px'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          items: {
            type: 'string'
          },
          description: '需要的功能列表'
        }
      }
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        js: {
          type: 'string'
        },
        fileName: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'JS生成器基础用法',
        params: {
          features: ['item1', 'item2']
        }
      },
      {
        description: 'JS生成器高级用法',
        params: {
          features: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        projectPath: {
          type: 'string'
        },
        createdFiles: {
          type: 'array'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        repoPath: {
          type: 'string'
        },
        branch: {
          type: 'string'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        commitHash: {
          type: 'string'
        },
        message: {
          type: 'string'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: '搜索相关文档',
        params: {
          query: '如何使用API',
          index: 'knowledge_base',
          options: {
            top_k: 5,
            similarity_threshold: 0.7
          }
        }
      },
      {
        description: '语义搜索',
        params: {
          query: '智能合约安全问题',
          index: 'blockchain_docs',
          options: {
            semantic: true,
            top_k: 10
          }
        }
      }
    ],
    required_permissions: ['database:read', 'ai:search'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
              type: {
                type: 'string',
                enum: ['replace', 'insert', 'delete']
              },
              search: {
                type: 'string'
              },
              replacement: {
                type: 'string'
              },
              line: {
                type: 'number'
              }
            }
          }
        }
      },
      required: ['filePath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        changes: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '文件编辑基础用法',
        params: {
          filePath: './data/sample.dat',
          operations: ['item1', 'item2']
        }
      },
      {
        description: '文件编辑高级用法',
        params: {
          filePath: './advanced_data/sample.dat',
          operations: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        formatted: {
          type: 'string'
        },
        format: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '格式化输出基础用法',
        params: {
          content: '示例文本',
          format: 'json',
          options: 'value'
        }
      },
      {
        description: '格式化输出高级用法',
        params: {
          content: '更复杂的示例文本内容，用于测试高级功能',
          format: 'markdown',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '解析API响应JSON',
        params: {
          jsonString: `{"status":"success","data":{"id":123,"name":"张三"}}`,
          strict: true
        }
      },
      {
        description: '解析配置文件JSON',
        params: {
          jsonString: `{"database":{"host":"localhost","port":5432}}`,
          strict: false
        }
      },
      {
        description: '解析JSON数组',
        params: {
          jsonString: `[{"id":1,"name":"项目A"},{"id":2,"name":"项目B"}]`,
          strict: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '解析Docker Compose配置',
        params: {
          yamlString: `version: "3"
services:
  web:
    image: nginx
    ports:
      - "80:80"`,
          options: {
            strict: true
          }
        }
      },
      {
        description: '解析应用配置YAML',
        params: {
          yamlString: `app:
  name: MyApp
  debug: true
  database:
    host: localhost`,
          options: {
            strict: false
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            wordFrequency: {
              type: 'boolean',
              default: true
            },
            sentiment: {
              type: 'boolean',
              default: false
            },
            keywords: {
              type: 'boolean',
              default: false
            }
          }
        }
      },
      required: ['text']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        stats: {
          type: 'object',
          properties: {
            charCount: {
              type: 'number'
            },
            wordCount: {
              type: 'number'
            },
            sentenceCount: {
              type: 'number'
            },
            lineCount: {
              type: 'number'
            }
          }
        },
        wordFrequency: {
          type: 'object'
        },
        keywords: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: '分析文章情感倾向',
        params: {
          text: '这个产品非常好用，我很满意！',
          options: {
            sentiment: true,
            keywords: true
          }
        }
      },
      {
        description: '分析文本统计信息',
        params: {
          text: '人工智能技术正在改变世界...',
          options: {
            wordCount: true,
            readability: true,
            language: 'zh'
          }
        }
      },
      {
        description: '提取关键词和实体',
        params: {
          text: '苹果公司在加州库比蒂诺发布了新产品',
          options: {
            keywords: true,
            entities: true,
            limit: 10
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          enum: [
            'year',
            'month',
            'day',
            'hour',
            'minute',
            'second'
          ]
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        },
        timestamp: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '日期时间处理器基础用法',
        params: {
          action: 'format',
          date: 'value',
          format: 'YYYY-MM-DD HH:mm:ss',
          amount: 10,
          unit: 'year'
        }
      },
      {
        description: '日期时间处理器高级用法',
        params: {
          action: 'parse',
          date: 'advanced_value',
          format: 'YYYY-MM-DD HH:mm:ss',
          amount: 50,
          unit: 'month'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        valid: {
          type: 'boolean'
        }
      }
    },
    examples: [
      {
        description: '基本网络URL处理器',
        params: {
          url: 'https://api.example.com/endpoint',
          action: 'parse',
          params: 'value'
        }
      },
      {
        description: '高级网络URL处理器',
        params: {
          url: 'https://api.example.com/advanced_endpoint',
          action: 'build',
          params: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        },
        algorithm: {
          type: 'string'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        status: {
          type: 'number'
        },
        headers: {
          type: 'object'
        },
        data: {
          type: 'any'
        }
      }
    },
    examples: [
      {
        description: '基本网络HTTP客户端',
        params: {
          url: 'https://api.example.com/endpoint',
          method: 'GET',
          headers: 'value',
          body: 'value',
          timeout: 10
        }
      },
      {
        description: '高级网络HTTP客户端',
        params: {
          url: 'https://api.example.com/advanced_endpoint',
          method: 'POST',
          headers: 'advanced_value',
          body: 'advanced_value',
          timeout: 50
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        matches: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: '使用正则表达式测试器处理短文本',
        params: {
          pattern: 'example_value',
          text: '这是一段示例文本',
          action: 'test',
          replacement: 'example_value',
          flags: 'g'
        }
      },
      {
        description: '使用正则表达式测试器处理长文本',
        params: {
          pattern: 'example_value',
          text: '这是一段示例文本',
          action: 'test',
          replacement: 'example_value',
          flags: 'g'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            sanitize: {
              type: 'boolean',
              default: true
            },
            breaks: {
              type: 'boolean',
              default: true
            },
            tables: {
              type: 'boolean',
              default: true
            }
          }
        }
      },
      required: ['markdown']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        },
        format: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'Markdown转换器基础用法',
        params: {
          markdown: 'value',
          targetFormat: 'html',
          options: 'value'
        }
      },
      {
        description: 'Markdown转换器高级用法',
        params: {
          markdown: 'advanced_value',
          targetFormat: 'plain',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            delimiter: {
              type: 'string',
              default: ','
            },
            header: {
              type: 'boolean',
              default: true
            },
            quote: {
              type: 'string',
              default: `"`
            }
          }
        }
      },
      required: ['action', 'data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        rowCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '解析CSV数据表',
        params: {
          csvData: `name,age,city
张三,25,北京
李四,30,上海`,
          options: {
            header: true,
            delimiter: ','
          }
        }
      },
      {
        description: '生成CSV导出文件',
        params: {
          data: [
            {
              name: '张三',
              age: 25
            },
            {
              name: '李四',
              age: 30
            }
          ],
          options: {
            header: true,
            delimiter: ','
          }
        }
      },
      {
        description: '处理大型CSV文件（流式）',
        params: {
          filePath: './data/large-dataset.csv',
          options: {
            streaming: true,
            batchSize: 1000
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        zipPath: {
          type: 'string'
        },
        files: {
          type: 'array'
        },
        size: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: 'ZIP压缩工具基础用法',
        params: {
          action: 'compress',
          source: 'value',
          target: 'value',
          password: 'value'
        }
      },
      {
        description: 'ZIP压缩工具高级用法',
        params: {
          action: 'extract',
          source: 'advanced_value',
          target: 'advanced_value',
          password: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        data: {
          type: 'array'
        },
        sheets: {
          type: 'array'
        },
        rowCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '读取Excel财务报表',
        params: {
          filePath: './reports/财务报表.xlsx',
          sheetName: 'Sheet1',
          options: {
            header: true
          }
        }
      },
      {
        description: '读取Excel特定范围',
        params: {
          filePath: './data.xlsx',
          sheetName: 'Data',
          range: 'A1:E100',
          options: {
            header: true
          }
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          items: {
            type: 'string'
          }
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
        success: {
          type: 'boolean'
        },
        sql: {
          type: 'string'
        },
        params: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: '构建SELECT查询',
        params: {
          action: 'select',
          table: 'users',
          fields: ['id', 'name', 'email'],
          where: {
            status: 'active'
          },
          limit: 10
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        width: {
          type: 'number'
        },
        height: {
          type: 'number'
        },
        format: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        exif: {
          type: 'object'
        }
      }
    },
    examples: [
      {
        description: '图片元数据提取器基础用法',
        params: {
          imagePath: './data/sample.dat',
          extractEXIF: false
        }
      },
      {
        description: '图片元数据提取器高级用法',
        params: {
          imagePath: './advanced_data/sample.dat',
          extractEXIF: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        variables: {
          type: 'object'
        },
        count: {
          type: 'number'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        hex: {
          type: 'string'
        },
        rgb: {
          type: 'object'
        },
        hsl: {
          type: 'object'
        }
      }
    },
    examples: [
      {
        description: '颜色转换器基础用法',
        params: {
          color: 'value',
          from: 'hex',
          to: 'hex'
        }
      },
      {
        description: '颜色转换器高级用法',
        params: {
          color: 'advanced_value',
          from: 'rgb',
          to: 'rgb'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          enum: [
            'number',
            'string',
            'uuid',
            'boolean',
            'date',
            'color'
          ]
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
            min: {
              type: 'number'
            },
            max: {
              type: 'number'
            },
            length: {
              type: 'number'
            },
            charset: {
              type: 'string'
            }
          }
        }
      },
      required: ['type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        count: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '随机数据生成器基础用法',
        params: {
          type: 'number',
          count: 10,
          options: 'value'
        }
      },
      {
        description: '随机数据生成器高级用法',
        params: {
          type: 'string',
          count: 50,
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        files: {
          type: 'array'
        },
        count: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '在项目中搜索JavaScript文件',
        params: {
          directory: './src',
          pattern: '*.js',
          recursive: true
        }
      },
      {
        description: '搜索包含特定关键词的文件',
        params: {
          directory: './docs',
          pattern: '*.md',
          content: '使用教程',
          recursive: true
        }
      },
      {
        description: '搜索最近修改的文件',
        params: {
          directory: './uploads',
          pattern: '*.*',
          modifiedAfter: '2025-01-01',
          recursive: false
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '渲染问候模板',
        params: {
          template: 'Hello {{name}}, welcome to {{app}}!',
          variables: {
            name: 'John',
            app: 'ChainlessChain'
          },
          syntax: 'mustache'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        },
        format: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'QR码生成器基础用法',
        params: {
          data: 'value',
          size: 10,
          format: 'png',
          errorLevel: 'L'
        }
      },
      {
        description: 'QR码生成器高级用法',
        params: {
          data: 'advanced_value',
          size: 50,
          format: 'svg',
          errorLevel: 'M'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        diff: {
          type: 'string'
        },
        changes: {
          type: 'number'
        },
        additions: {
          type: 'number'
        },
        deletions: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '使用Diff比较器处理短文本',
        params: {
          text1: '这是一段示例文本',
          text2: '这是一段示例文本',
          format: 'unified',
          ignoreWhitespace: false
        }
      },
      {
        description: '使用Diff比较器处理长文本',
        params: {
          text1: '这是一段示例文本',
          text2: '这是一段示例文本',
          format: 'unified',
          ignoreWhitespace: false
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        hash: {
          type: 'string'
        },
        algorithm: {
          type: 'string'
        },
        verified: {
          type: 'boolean'
        }
      }
    },
    examples: [
      {
        description: 'Hash校验器基础用法',
        params: {
          filePath: './data/sample.dat',
          text: '示例文本',
          algorithm: 'md5',
          expectedHash: 'value'
        }
      },
      {
        description: 'Hash校验器高级用法',
        params: {
          filePath: './advanced_data/sample.dat',
          text: '更复杂的示例文本内容，用于测试高级功能',
          algorithm: 'sha1',
          expectedHash: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        isValid: {
          type: 'boolean'
        },
        version: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络IP地址工具',
        params: {
          action: 'validate',
          ip: 'value',
          cidr: 'value'
        }
      },
      {
        description: '高级网络IP地址工具',
        params: {
          action: 'parse',
          ip: 'advanced_value',
          cidr: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        browser: {
          type: 'object'
        },
        os: {
          type: 'object'
        },
        device: {
          type: 'object'
        }
      }
    },
    examples: [
      {
        description: '基本网络User-Agent解析器',
        params: {
          userAgent: 'value'
        }
      },
      {
        description: '高级网络User-Agent解析器',
        params: {
          userAgent: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        description: {
          type: 'string'
        },
        nextRun: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'Cron表达式解析器基础用法',
        params: {
          action: 'parse',
          expression: 'value',
          description: 'value'
        }
      },
      {
        description: 'Cron表达式解析器高级用法',
        params: {
          action: 'generate',
          expression: 'advanced_value',
          description: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          enum: [
            'javascript',
            'json',
            'html',
            'css',
            'sql',
            'python'
          ],
          default: 'javascript'
        },
        options: {
          type: 'object',
          description: '格式化选项',
          properties: {
            indent: {
              type: 'number',
              default: 2
            },
            semicolons: {
              type: 'boolean',
              default: true
            }
          }
        }
      },
      required: ['code', 'language']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        formatted: {
          type: 'string'
        },
        language: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          code: 'value',
          language: 'javascript',
          options: 'value'
        }
      },
      {
        description: '处理复杂项目',
        params: {
          code: 'advanced_value',
          language: 'json',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        encoding: {
          type: 'string'
        },
        confidence: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '使用文本编码检测器处理短文本',
        params: {
          filePath: './data/sample.dat',
          buffer: 'example_value'
        }
      },
      {
        description: '使用文本编码检测器处理长文本',
        params: {
          filePath: './data/sample.dat',
          buffer: 'example_value'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        comparison: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '版本号比较器基础用法',
        params: {
          action: 'compare',
          version1: 'value',
          version2: 'value',
          bumpType: 'major'
        }
      },
      {
        description: '版本号比较器高级用法',
        params: {
          action: 'validate',
          version1: 'advanced_value',
          version2: 'advanced_value',
          bumpType: 'minor'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        header: {
          type: 'object'
        },
        payload: {
          type: 'object'
        },
        signature: {
          type: 'string'
        },
        verified: {
          type: 'boolean'
        }
      }
    },
    examples: [
      {
        description: 'JWT解析器基础用法',
        params: {
          token: 'value',
          action: 'decode',
          secret: 'value'
        }
      },
      {
        description: 'JWT解析器高级用法',
        params: {
          token: 'advanced_value',
          action: 'verify',
          secret: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        valid: {
          type: 'boolean'
        }
      }
    },
    examples: [
      {
        description: '解析RSS订阅XML',
        params: {
          xmlString: '<rss><channel><title>新闻</title><item><title>标题</title></item></channel></rss>',
          options: {
            ignoreAttributes: false
          }
        }
      },
      {
        description: '解析配置XML',
        params: {
          xmlString: `<config><database host="localhost" port="5432"/></config>`,
          options: {
            parseAttributeValue: true
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        elements: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: 'HTML解析器基础用法',
        params: {
          html: 'value',
          selector: 'value',
          action: 'parse'
        }
      },
      {
        description: 'HTML解析器高级用法',
        params: {
          html: 'advanced_value',
          selector: 'advanced_value',
          action: 'query'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        }
      }
    },
    examples: [
      {
        description: '解析TOML配置',
        params: {
          action: 'parse',
          toml: `[server]
port = 8080`
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        }
      }
    },
    examples: [
      {
        description: '解析INI文件',
        params: {
          action: 'parse',
          ini: `[section]
key=value`
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          enum: [
            'A',
            'AAAA',
            'MX',
            'TXT',
            'NS',
            'CNAME'
          ],
          default: 'A'
        }
      },
      required: ['domain']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        records: {
          type: 'array'
        },
        type: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络DNS查询器',
        params: {
          domain: 'value',
          recordType: 'A'
        }
      },
      {
        description: '高级网络DNS查询器',
        params: {
          domain: 'advanced_value',
          recordType: 'AAAA'
        }
      }
    ],
    required_permissions: ['network:dns'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        isOpen: {
          type: 'boolean'
        },
        host: {
          type: 'string'
        },
        port: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '基本网络端口检测器',
        params: {
          host: 'value',
          port: 10,
          timeout: 10
        }
      },
      {
        description: '高级网络端口检测器',
        params: {
          host: 'advanced_value',
          port: 50,
          timeout: 50
        }
      }
    ],
    required_permissions: ['network:connect'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        isValid: {
          type: 'boolean'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        slug: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用Slug生成器处理短文本',
        params: {
          text: '这是一段示例文本',
          separator: '-',
          lowercase: true
        }
      },
      {
        description: '使用Slug生成器处理长文本',
        params: {
          text: '这是一段示例文本',
          separator: '-',
          lowercase: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        files: {
          type: 'array'
        },
        additions: {
          type: 'number'
        },
        deletions: {
          type: 'number'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        language: {
          type: 'string'
        },
        confidence: {
          type: 'number'
        },
        alternatives: {
          type: 'array'
        }
      }
    },
    examples: [
      {
        description: '使用语言检测器处理短文本',
        params: {
          text: '这是一段示例文本'
        }
      },
      {
        description: '使用语言检测器处理长文本',
        params: {
          text: '这是一段示例文本'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        metadata: {
          type: 'object',
          properties: {
            duration: {
              type: 'number',
              description: '时长（秒）'
            },
            width: {
              type: 'number'
            },
            height: {
              type: 'number'
            },
            codec: {
              type: 'string'
            },
            fps: {
              type: 'number'
            },
            bitrate: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '视频元数据读取器基础用法',
        params: {
          filePath: './data/sample.dat'
        }
      },
      {
        description: '视频元数据读取器高级用法',
        params: {
          filePath: './advanced_data/sample.dat'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        duration: {
          type: 'number',
          description: '时长（秒）'
        },
        format: {
          type: 'string'
        },
        sampleRate: {
          type: 'number'
        },
        channels: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '音频时长计算器基础用法',
        params: {
          filePath: './data/sample.dat'
        }
      },
      {
        description: '音频时长计算器高级用法',
        params: {
          filePath: './advanced_data/sample.dat'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        subtitles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: {
                type: 'number'
              },
              start: {
                type: 'string'
              },
              end: {
                type: 'string'
              },
              text: {
                type: 'string'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '字幕解析器基础用法',
        params: {
          content: '示例文本',
          format: 'srt'
        }
      },
      {
        description: '字幕解析器高级用法',
        params: {
          content: '更复杂的示例文本内容，用于测试高级功能',
          format: 'vtt'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        prediction: {
          type: 'any'
        },
        confidence: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '单次模型预测器',
        params: {
          modelPath: './models/trained_model.pkl',
          input: 'value',
          framework: 'onnx'
        }
      },
      {
        description: '持续模型预测器',
        params: {
          modelPath: './advanced_models/trained_model.pkl',
          input: 'advanced_value',
          framework: 'tensorflow',
          continuous: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
              field: {
                type: 'string'
              },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '聚合销售数据',
        params: {
          data: [
            {
              product: 'A',
              sales: 100,
              region: '北京'
            },
            {
              product: 'A',
              sales: 150,
              region: '上海'
            },
            {
              product: 'B',
              sales: 200,
              region: '北京'
            }
          ],
          groupBy: ['product'],
          aggregations: {
            sales: 'sum'
          }
        }
      },
      {
        description: '多维度数据聚合',
        params: {
          data: [
            {
              date: '2025-01',
              revenue: 10000,
              cost: 6000
            }
          ],
          groupBy: ['date'],
          aggregations: {
            revenue: 'sum',
            cost: 'sum',
            profit: 'calculated'
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
          items: {
            type: 'number'
          }
        },
        metrics: {
          type: 'array',
          description: '要计算的指标',
          items: {
            type: 'string',
            enum: [
              'mean',
              'median',
              'mode',
              'variance',
              'stddev',
              'min',
              'max',
              'percentile'
            ]
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
        success: {
          type: 'boolean'
        },
        statistics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用统计计算器处理基础数据',
        params: {
          data: ['item1', 'item2'],
          metrics: ['item1', 'item2'],
          percentile: 100
        }
      },
      {
        description: '使用统计计算器处理批量数据',
        params: {
          data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          metrics: ['item1', 'item2', 'item3', 'item4', 'item5'],
          percentile: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        chartData: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用图表数据生成器处理基础数据',
        params: {
          data: ['item1', 'item2'],
          chartType: 'line',
          xField: 'example_value',
          yField: 'example_value'
        }
      },
      {
        description: '使用图表数据生成器处理批量数据',
        params: {
          data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          chartType: 'line',
          xField: 'example_value',
          yField: 'example_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        status: {
          type: 'number'
        },
        data: {
          type: 'any'
        },
        headers: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '获取用户信息',
        params: {
          url: 'https://api.example.com/users/123',
          method: 'GET',
          headers: {
            Authorization: 'Bearer token123'
          }
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        accessToken: {
          type: 'string'
        },
        refreshToken: {
          type: 'string'
        },
        expiresIn: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            accessKeyId: {
              type: 'string'
            },
            secretAccessKey: {
              type: 'string'
            },
            region: {
              type: 'string'
            }
          }
        }
      },
      required: ['action', 'bucket']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            accessKeyId: {
              type: 'string'
            },
            accessKeySecret: {
              type: 'string'
            },
            region: {
              type: 'string'
            }
          }
        }
      },
      required: ['action', 'bucket']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              timestamp: {
                type: 'string'
              },
              level: {
                type: 'string'
              },
              message: {
                type: 'string'
              },
              metadata: {
                type: 'object'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '解析 Nginx 访问日志',
        params: {
          logContent: `127.0.0.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200`,
          format: 'nginx'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        metrics: {
          type: 'object',
          properties: {
            cpuUsage: {
              type: 'number'
            },
            memoryUsage: {
              type: 'number'
            },
            executionTime: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        snapshot: {
          type: 'object',
          properties: {
            heapUsed: {
              type: 'number'
            },
            heapTotal: {
              type: 'number'
            },
            external: {
              type: 'number'
            },
            rss: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        translated: {
          type: 'string'
        },
        detectedLanguage: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '翻译器基础用法',
        params: {
          text: '示例文本',
          from: 'auto',
          to: 'value',
          service: 'google'
        }
      },
      {
        description: '翻译器高级用法',
        params: {
          text: '更复杂的示例文本内容，用于测试高级功能',
          from: 'auto',
          to: 'advanced_value',
          service: 'baidu'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        formatted: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '格式化Markdown文档',
        params: {
          text: `# 标题

这是内容`,
          format: 'markdown',
          options: {
            prettify: true
          }
        }
      },
      {
        description: '格式化代码',
        params: {
          text: 'function test(){return true;}',
          format: 'javascript',
          options: {
            indent: 2,
            semicolons: true
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
                  id: {
                    type: 'string'
                  },
                  tool: {
                    type: 'string'
                  },
                  params: {
                    type: 'object'
                  },
                  condition: {
                    type: 'string'
                  }
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '执行数据处理工作流',
        params: {
          workflow: {
            steps: [
              {
                id: 'read',
                tool: 'file_reader',
                params: {
                  filePath: 'data.csv'
                }
              },
              {
                id: 'parse',
                tool: 'csv_handler',
                params: {
                  action: 'parse'
                }
              }
            ]
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '事件发射器基础用法',
        params: {
          action: 'emit',
          event: 'value',
          data: 'value',
          handler: 'value'
        }
      },
      {
        description: '事件发射器高级用法',
        params: {
          action: 'on',
          event: 'advanced_value',
          data: 'advanced_value',
          handler: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
              name: {
                type: 'string'
              },
              transform: {
                type: 'string'
              },
              params: {
                type: 'object'
              }
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
        success: {
          type: 'boolean'
        },
        output: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '数据管道构建器基础用法',
        params: {
          pipeline: ['item1', 'item2'],
          input: 'value'
        }
      },
      {
        description: '数据管道构建器高级用法',
        params: {
          pipeline: ['item1', 'item2', 'item3', 'item4'],
          input: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '查询以太坊余额',
        params: {
          network: 'ethereum',
          action: 'getBalance',
          params: {
            address: '0x...'
          }
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        transactionHash: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        address: {
          type: 'string'
        },
        privateKey: {
          type: 'string'
        },
        mnemonic: {
          type: 'string'
        },
        signature: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
          items: {
            type: 'string'
          }
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
        success: {
          type: 'boolean'
        },
        messageId: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            host: {
              type: 'string'
            },
            port: {
              type: 'number'
            },
            user: {
              type: 'string'
            },
            password: {
              type: 'string'
            },
            tls: {
              type: 'boolean'
            }
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
        success: {
          type: 'boolean'
        },
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: {
                type: 'string'
              },
              subject: {
                type: 'string'
              },
              date: {
                type: 'string'
              },
              body: {
                type: 'string'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        attachments: {
          type: 'array'
        },
        savedPath: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            format: {
              type: 'string',
              default: 'A4'
            },
            margin: {
              type: 'object'
            },
            landscape: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['content', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          content: '示例文本',
          contentType: '示例文本',
          outputPath: './output/result.json',
          options: 'value'
        }
      },
      {
        description: '批量处理文档',
        params: {
          content: '更复杂的示例文本内容，用于测试高级功能',
          contentType: '更复杂的示例文本内容，用于测试高级功能',
          outputPath: './advanced_output/result.json',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
          items: {
            type: 'number'
          }
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
        success: {
          type: 'boolean'
        },
        text: {
          type: 'string'
        },
        pageCount: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          pdfPath: './data/sample.dat',
          pages: ['item1', 'item2'],
          preserveLayout: false
        }
      },
      {
        description: '批量处理文档',
        params: {
          pdfPath: './advanced_data/sample.dat',
          pages: ['item1', 'item2', 'item3', 'item4'],
          preserveLayout: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
          items: {
            type: 'string'
          }
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
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        pageCount: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          action: 'merge',
          inputFiles: './input/data.json',
          outputPath: './output/result.json',
          pageRanges: ['item1', 'item2']
        }
      },
      {
        description: '批量处理文档',
        params: {
          action: 'split',
          inputFiles: './advanced_input/data.json',
          outputPath: './advanced_output/result.json',
          pageRanges: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        text: {
          type: 'string'
        },
        confidence: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
          default: 1
        }
      },
      required: ['text', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        audioPath: {
          type: 'string'
        },
        duration: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        imagePath: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '渲染折线图',
        params: {
          chartConfig: {
            type: 'line',
            data: {
              labels: ['Jan', 'Feb'],
              datasets: [
                {
                  data: [10, 20]
                }
              ]
            }
          },
          outputPath: '/path/to/chart.png'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        data: {
          type: 'object'
        },
        links: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        extracted: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络HTML内容提取器',
        params: {
          html: 'value',
          extractType: 'text',
          selector: 'value'
        }
      },
      {
        description: '高级网络HTML内容提取器',
        params: {
          html: 'advanced_value',
          extractType: 'links',
          selector: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              field: {
                type: 'string'
              },
              type: {
                type: 'string'
              },
              required: {
                type: 'boolean'
              },
              min: {
                type: 'number'
              },
              max: {
                type: 'number'
              },
              pattern: {
                type: 'string'
              }
            }
          }
        }
      },
      required: ['data', 'rules']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        valid: {
          type: 'boolean'
        },
        errors: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '验证用户注册数据',
        params: {
          data: {
            username: 'john',
            email: 'john@example.com',
            age: 25
          },
          schema: {
            username: {
              type: 'string',
              minLength: 3,
              maxLength: 20
            },
            email: {
              type: 'string',
              format: 'email'
            },
            age: {
              type: 'number',
              minimum: 18
            }
          }
        }
      },
      {
        description: '验证API请求参数',
        params: {
          data: {
            page: 1,
            limit: 20,
            sortBy: 'createdAt'
          },
          schema: {
            page: {
              type: 'integer',
              minimum: 1
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100
            },
            sortBy: {
              type: 'string',
              enum: ['createdAt', 'updatedAt', 'name']
            }
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        valid: {
          type: 'boolean'
        },
        errors: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '验证用户注册数据',
        params: {
          data: {
            username: 'john',
            email: 'john@example.com',
            age: 25
          },
          schema: {
            username: {
              type: 'string',
              minLength: 3,
              maxLength: 20
            },
            email: {
              type: 'string',
              format: 'email'
            },
            age: {
              type: 'number',
              minimum: 18
            }
          }
        }
      },
      {
        description: '验证API请求参数',
        params: {
          data: {
            page: 1,
            limit: 20,
            sortBy: 'createdAt'
          },
          schema: {
            page: {
              type: 'integer',
              minimum: 1
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 100
            },
            sortBy: {
              type: 'string',
              enum: ['createdAt', 'updatedAt', 'name']
            }
          }
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        value: {
          type: 'any'
        },
        exists: {
          type: 'boolean'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '设置缓存',
        params: {
          action: 'set',
          key: 'user:123',
          value: {
            name: 'John'
          },
          ttl: 3600
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        messageId: {
          type: 'string'
        },
        messages: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '发布消息',
        params: {
          action: 'publish',
          queue: 'tasks',
          message: {
            task: 'process',
            data: {}
          }
        }
      }
    ],
    required_permissions: ['network:amqp'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
          enum: [
            'list',
            'start',
            'stop',
            'remove',
            'create',
            'exec',
            'logs'
          ]
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        output: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        signature: {
          type: 'string'
        },
        verified: {
          type: 'boolean'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
          enum: [
            128,
            192,
            256,
            1024,
            2048,
            4096
          ]
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
        success: {
          type: 'boolean'
        },
        privateKey: {
          type: 'string'
        },
        publicKey: {
          type: 'string'
        },
        key: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
              timestamp: {
                type: 'string'
              },
              value: {
                type: 'number'
              }
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用时间序列分析器处理基础数据',
        params: {
          data: ['item1', 'item2'],
          analysis: ['item1', 'item2'],
          forecastPeriods: 100
        }
      },
      {
        description: '使用时间序列分析器处理批量数据',
        params: {
          data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          analysis: ['item1', 'item2', 'item3', 'item4', 'item5'],
          forecastPeriods: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
          items: {
            type: 'number'
          }
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
        success: {
          type: 'boolean'
        },
        trend: {
          type: 'string',
          enum: ['upward', 'downward', 'stable', 'volatile']
        },
        strength: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用趋势检测器处理基础数据',
        params: {
          data: ['item1', 'item2'],
          window: 100,
          sensitivity: 100
        }
      },
      {
        description: '使用趋势检测器处理批量数据',
        params: {
          data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          window: 100,
          sensitivity: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        watcherId: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '文件监视器基础用法',
        params: {
          action: 'watch',
          path: './data/sample.dat',
          events: ['item1', 'item2'],
          callback: 'value'
        }
      },
      {
        description: '文件监视器高级用法',
        params: {
          action: 'unwatch',
          path: './advanced_data/sample.dat',
          events: ['item1', 'item2', 'item3', 'item4'],
          callback: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:watch'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        monitorId: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '目录监控器基础用法',
        params: {
          directory: 'value',
          recursive: false,
          filter: 'value',
          debounce: 10
        }
      },
      {
        description: '目录监控器高级用法',
        params: {
          directory: 'advanced_value',
          recursive: true,
          filter: 'advanced_value',
          debounce: 50
        }
      }
    ],
    required_permissions: ['file:watch'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        taskId: {
          type: 'string'
        },
        nextRun: {
          type: 'string'
        },
        tasks: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'Cron调度器基础用法',
        params: {
          action: 'schedule',
          cronExpression: 'value',
          taskId: 'value',
          task: 'value',
          timezone: 'UTC'
        }
      },
      {
        description: 'Cron调度器高级用法',
        params: {
          action: 'cancel',
          cronExpression: 'advanced_value',
          taskId: 'advanced_value',
          task: 'advanced_value',
          timezone: 'UTC'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        timerId: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '任务定时器基础用法',
        params: {
          action: 'setTimeout',
          delay: 10,
          interval: 10,
          timerId: 'value',
          task: 'value'
        }
      },
      {
        description: '任务定时器高级用法',
        params: {
          action: 'setInterval',
          delay: 50,
          interval: 50,
          timerId: 'advanced_value',
          task: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        executed: {
          type: 'array'
        },
        pending: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            ignoreColumnOrder: {
              type: 'boolean',
              default: true
            },
            ignoreConstraints: {
              type: 'boolean',
              default: false
            }
          }
        }
      },
      required: ['source', 'target']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        differences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string'
              },
              table: {
                type: 'string'
              },
              column: {
                type: 'string'
              },
              change: {
                type: 'string'
              }
            }
          }
        },
        sqlStatements: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '比较开发和生产环境Schema',
        params: {
          source: {},
          target: {}
        }
      }
    ],
    required_permissions: ['database:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        serverId: {
          type: 'string'
        },
        clients: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        connectionId: {
          type: 'string'
        },
        data: {
          type: 'any'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络WebSocket客户端',
        params: {
          action: 'connect',
          url: 'https://api.example.com/endpoint',
          message: 'value',
          connectionId: 'value'
        }
      },
      {
        description: '高级网络WebSocket客户端',
        params: {
          action: 'disconnect',
          url: 'https://api.example.com/advanced_endpoint',
          message: 'advanced_value',
          connectionId: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:http'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            width: {
              type: 'number',
              default: 2
            },
            height: {
              type: 'number',
              default: 100
            },
            displayValue: {
              type: 'boolean',
              default: true
            }
          }
        }
      },
      required: ['data', 'format', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        imagePath: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '条形码生成器基础用法',
        params: {
          data: 'value',
          format: 'CODE128',
          outputPath: './output/result.json',
          options: 'value'
        }
      },
      {
        description: '条形码生成器高级用法',
        params: {
          data: 'advanced_value',
          format: 'EAN13',
          outputPath: './advanced_output/result.json',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        codes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string'
              },
              data: {
                type: 'string'
              },
              format: {
                type: 'string'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '码识别器基础用法',
        params: {
          imagePath: './data/sample.dat',
          type: 'qrcode'
        }
      },
      {
        description: '码识别器高级用法',
        params: {
          imagePath: './advanced_data/sample.dat',
          type: 'barcode'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        latitude: {
          type: 'number'
        },
        longitude: {
          type: 'number'
        },
        address: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
            latitude: {
              type: 'number'
            },
            longitude: {
              type: 'number'
            }
          }
        },
        point2: {
          type: 'object',
          description: '终点坐标',
          properties: {
            latitude: {
              type: 'number'
            },
            longitude: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        distance: {
          type: 'number'
        },
        unit: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '计算北京到上海距离',
        params: {
          point1: {
            latitude: 39.9042,
            longitude: 116.4074
          },
          point2: {
            latitude: 31.2304,
            longitude: 121.4737
          },
          unit: 'km'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        latitude: {
          type: 'number'
        },
        longitude: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        duration: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
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
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        screenshots: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '视频截图器基础用法',
        params: {
          videoPath: './data/sample.dat',
          outputPath: './output/result.json',
          timestamp: 'value',
          count: 10,
          interval: 10
        }
      },
      {
        description: '视频截图器高级用法',
        params: {
          videoPath: './advanced_data/sample.dat',
          outputPath: './advanced_output/result.json',
          timestamp: 'advanced_value',
          count: 50,
          interval: 50
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              line: {
                type: 'number'
              },
              column: {
                type: 'number'
              },
              severity: {
                type: 'string'
              },
              message: {
                type: 'string'
              },
              rule: {
                type: 'string'
              }
            }
          }
        },
        fixedCode: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          code: 'value',
          language: 'javascript',
          rules: 'value',
          fix: false
        }
      },
      {
        description: '处理复杂项目',
        params: {
          code: 'advanced_value',
          language: 'typescript',
          rules: 'advanced_value',
          fix: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        ast: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          code: 'value',
          language: 'javascript',
          includeComments: false
        }
      },
      {
        description: '处理复杂项目',
        params: {
          code: 'advanced_value',
          language: 'typescript',
          includeComments: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        complexity: {
          type: 'object',
          properties: {
            cyclomatic: {
              type: 'number'
            },
            cognitive: {
              type: 'number'
            },
            halstead: {
              type: 'object'
            },
            loc: {
              type: 'number'
            }
          }
        },
        functions: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          code: 'value',
          language: 'javascript',
          metrics: ['item1', 'item2']
        }
      },
      {
        description: '处理复杂项目',
        params: {
          code: 'advanced_value',
          language: 'typescript',
          metrics: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            width: {
              type: 'number'
            },
            height: {
              type: 'number'
            },
            depth: {
              type: 'number'
            },
            radius: {
              type: 'number'
            },
            segments: {
              type: 'number'
            }
          }
        },
        material: {
          type: 'object',
          description: '材质属性',
          properties: {
            color: {
              type: 'string'
            },
            texture: {
              type: 'string'
            },
            opacity: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        modelPath: {
          type: 'string'
        },
        vertices: {
          type: 'number'
        },
        faces: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          type: 'cube',
          dimensions: 'example_value',
          material: 'example_value',
          outputFormat: 'obj'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
          enum: [
            'obj',
            'stl',
            'gltf',
            'fbx',
            'dae',
            '3ds'
          ]
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
            optimize: {
              type: 'boolean'
            },
            scale: {
              type: 'number'
            },
            centerModel: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['inputPath', 'inputFormat', 'outputFormat']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        fileSize: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '模型格式转换器基础用法',
        params: {
          inputPath: './input/data.json',
          inputFormat: 'obj',
          outputFormat: 'obj',
          options: 'value'
        }
      },
      {
        description: '模型格式转换器高级用法',
        params: {
          inputPath: './advanced_input/data.json',
          inputFormat: 'stl',
          outputFormat: 'stl',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        fingerprint: {
          type: 'string'
        },
        duration: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          audioPath: './audio/sample.mp3',
          algorithm: 'chromaprint',
          duration: 10
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'any'
        },
        transactionHash: {
          type: 'string'
        },
        gasUsed: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '网络请求示例',
        params: {
          contractAddress: 'example_value',
          abi: ['item1', 'item2'],
          method: 'example_value',
          params: ['item1', 'item2'],
          network: 'mainnet'
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },
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
          enum: [
            'line',
            'bar',
            'pie',
            'scatter',
            'area',
            'radar'
          ]
        },
        data: {
          type: 'object',
          description: '图表数据',
          properties: {
            labels: {
              type: 'array'
            },
            datasets: {
              type: 'array'
            }
          }
        },
        options: {
          type: 'object',
          description: '图表选项',
          properties: {
            title: {
              type: 'string'
            },
            width: {
              type: 'number'
            },
            height: {
              type: 'number'
            },
            theme: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        chartPath: {
          type: 'string'
        },
        chartData: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用图表生成器处理基础数据',
        params: {
          chartType: 'line',
          data: 'example_value',
          options: 'example_value',
          outputFormat: 'png'
        }
      },
      {
        description: '使用图表生成器处理批量数据',
        params: {
          chartType: 'line',
          data: 'example_value',
          options: 'example_value',
          outputFormat: 'png'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
          description: `数学表达式(如 "x^2 + 2*x + 1")`
        },
        points: {
          type: 'array',
          description: '数据点数组'
        },
        range: {
          type: 'object',
          description: '坐标范围',
          properties: {
            xMin: {
              type: 'number'
            },
            xMax: {
              type: 'number'
            },
            yMin: {
              type: 'number'
            },
            yMax: {
              type: 'number'
            }
          }
        }
      },
      required: ['type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        imagePath: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用图形绘制器处理基础数据',
        params: {
          type: 'function',
          expression: 'example_value',
          points: ['item1', 'item2'],
          range: 'example_value'
        }
      },
      {
        description: '使用图形绘制器处理批量数据',
        params: {
          type: 'function',
          expression: 'example_value',
          points: ['item1', 'item2', 'item3', 'item4', 'item5'],
          range: 'example_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        deviceId: {
          type: 'string'
        },
        status: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络设备管理器',
        params: {
          action: 'register',
          deviceId: 'value',
          deviceType: 'sensor',
          config: 'value',
          command: 'value'
        }
      },
      {
        description: '高级网络设备管理器',
        params: {
          action: 'configure',
          deviceId: 'advanced_value',
          deviceType: 'actuator',
          config: 'advanced_value',
          command: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        connected: {
          type: 'boolean'
        },
        messages: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络MQTT客户端',
        params: {
          action: 'connect',
          broker: 'value',
          topic: 'value',
          message: 'value',
          qos: 10
        }
      },
      {
        description: '高级网络MQTT客户端',
        params: {
          action: 'publish',
          broker: 'advanced_value',
          topic: 'advanced_value',
          message: 'advanced_value',
          qos: 50
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_model_trainer',
    name: 'model_trainer',
    display_name: '机器学习模型训练器',
    description: '训练分类、回归、聚类等机器学习模型，支持sklearn、XGBoost、LightGBM等主流框架',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '训练数据路径'
        },
        targetColumn: {
          type: 'string',
          description: '目标变量列名'
        },
        modelType: {
          type: 'string',
          description: '模型类型',
          enum: [
            'linear_regression',
            'logistic_regression',
            'decision_tree',
            'random_forest',
            'xgboost',
            'lightgbm',
            'svm',
            'kmeans',
            'neural_network'
          ]
        },
        taskType: {
          type: 'string',
          enum: ['classification', 'regression', 'clustering'],
          description: '任务类型'
        },
        trainingData: {
          type: 'array',
          description: '训练数据（与dataPath二选一）'
        },
        labels: {
          type: 'array',
          description: '标签数据（与targetColumn配合使用）'
        },
        hyperparameters: {
          type: 'object',
          description: '超参数配置',
          properties: {
            n_estimators: {
              type: 'number'
            },
            max_depth: {
              type: 'number'
            },
            learning_rate: {
              type: 'number'
            },
            test_size: {
              type: 'number',
              default: 0.2
            },
            random_state: {
              type: 'number',
              default: 42
            }
          }
        },
        validationSplit: {
          type: 'number',
          description: '验证集比例'
        },
        cv_folds: {
          type: 'number',
          default: 5,
          description: '交叉验证折数'
        },
        autoTune: {
          type: 'boolean',
          default: false,
          description: '是否自动调优超参数'
        },
        modelOutputPath: {
          type: 'string',
          description: '模型保存路径'
        }
      },
      required: ['modelType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        modelPath: {
          type: 'string'
        },
        accuracy: {
          type: 'number'
        },
        metrics: {
          type: 'object',
          description: '模型评估指标'
        },
        trainingTime: {
          type: 'number'
        },
        bestParams: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '训练随机森林分类器',
        params: {
          dataPath: './data/train.csv',
          targetColumn: 'churn',
          modelType: 'random_forest',
          taskType: 'classification',
          hyperparameters: {
            n_estimators: 100,
            max_depth: 10,
            test_size: 0.2
          },
          cv_folds: 5,
          autoTune: true,
          modelOutputPath: './models/rf_model.pkl'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write', 'compute:intensive'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        category: {
          type: 'string'
        },
        confidence: {
          type: 'number'
        },
        scores: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用文本分类器进行AI推理',
        params: {
          text: '这是一段示例文本',
          taskType: 'topic',
          model: 'example_value',
          categories: ['item1', 'item2']
        }
      },
      {
        description: '使用文本分类器批量处理',
        params: {
          text: '这是一段示例文本',
          taskType: 'topic',
          model: 'example_value',
          categories: ['item1', 'item2', 'item3', 'item4', 'item5']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            enum: [
              'person',
              'location',
              'organization',
              'date',
              'money',
              'email'
            ]
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
        success: {
          type: 'boolean'
        },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: {
                type: 'string'
              },
              type: {
                type: 'string'
              },
              startIndex: {
                type: 'number'
              },
              endIndex: {
                type: 'number'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基础实体识别器',
        params: {
          text: '示例文本',
          entityTypes: ['item1', 'item2'],
          language: 'zh'
        }
      },
      {
        description: '批量实体识别器',
        params: {
          text: '更复杂的示例文本内容，用于测试高级功能',
          entityTypes: ['item1', 'item2', 'item3', 'item4'],
          language: 'en',
          batch: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        data: {
          type: 'object',
          properties: {
            cpu: {
              type: 'number'
            },
            memory: {
              type: 'object'
            },
            disk: {
              type: 'object'
            },
            network: {
              type: 'object'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '资源监控器基础用法',
        params: {
          metrics: ['item1', 'item2'],
          interval: 10,
          duration: 10
        }
      },
      {
        description: '资源监控器高级用法',
        params: {
          metrics: ['item1', 'item2', 'item3', 'item4'],
          interval: 50,
          duration: 50
        }
      }
    ],
    required_permissions: ['system:info'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        encoded: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用Protobuf编码器处理基础数据',
        params: {
          schema: 'example_value',
          messageName: 'example_value',
          data: 'example_value',
          outputFormat: 'binary'
        }
      },
      {
        description: '使用Protobuf编码器处理批量数据',
        params: {
          schema: 'example_value',
          messageName: 'example_value',
          data: 'example_value',
          outputFormat: 'binary'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        decoded: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用Protobuf解码器处理基础数据',
        params: {
          schema: 'example_value',
          messageName: 'example_value',
          data: 'example_value',
          inputFormat: 'binary'
        }
      },
      {
        description: '使用Protobuf解码器处理批量数据',
        params: {
          schema: 'example_value',
          messageName: 'example_value',
          data: 'example_value',
          inputFormat: 'binary'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
              id: {
                type: 'string'
              },
              content: {
                type: 'string'
              },
              metadata: {
                type: 'object'
              }
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
        success: {
          type: 'boolean'
        },
        indexed: {
          type: 'number'
        },
        totalDocuments: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '全文搜索文档',
        params: {
          query: '人工智能应用',
          index: 'documents',
          options: {
            fuzzy: true,
            limit: 10
          }
        }
      },
      {
        description: '高级搜索查询',
        params: {
          query: 'title:AI AND category:技术',
          index: 'articles',
          options: {
            boost: {
              title: 2
            },
            limit: 20
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            limit: {
              type: 'number'
            },
            offset: {
              type: 'number'
            },
            filters: {
              type: 'object'
            },
            sortBy: {
              type: 'string'
            },
            highlight: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['indexName', 'query']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string'
              },
              content: {
                type: 'string'
              },
              score: {
                type: 'number'
              },
              highlights: {
                type: 'array'
              }
            }
          }
        },
        total: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '全文搜索文档',
        params: {
          query: '人工智能应用',
          index: 'documents',
          options: {
            fuzzy: true,
            limit: 10
          }
        }
      },
      {
        description: '高级搜索查询',
        params: {
          query: 'title:AI AND category:技术',
          index: 'articles',
          options: {
            boost: {
              title: 2
            },
            limit: 20
          }
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            timeout: {
              type: 'number'
            },
            concurrent: {
              type: 'number'
            },
            aggressive: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['target', 'scanType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        vulnerabilities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: {
                type: 'string'
              },
              type: {
                type: 'string'
              },
              description: {
                type: 'string'
              },
              cve: {
                type: 'string'
              }
            }
          }
        },
        risk_score: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '漏洞扫描器使用示例',
        params: {
          target: 'example_value',
          scanType: 'port',
          depth: 'quick',
          options: {
            key: 'value',
            enabled: true
          }
        }
      }
    ],
    required_permissions: ['network:scan'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
          items: {
            type: 'string'
          }
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
        success: {
          type: 'boolean'
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: {
                type: 'string'
              },
              rule: {
                type: 'string'
              },
              location: {
                type: 'string'
              },
              recommendation: {
                type: 'string'
              }
            }
          }
        },
        compliance_score: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '安全审计器使用示例',
        params: {
          auditType: 'code',
          target: 'example_value',
          rules: ['item1', 'item2'],
          standard: 'owasp'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
            mass: {
              type: 'number'
            },
            friction: {
              type: 'number'
            },
            restitution: {
              type: 'number'
            },
            position: {
              type: 'array'
            },
            velocity: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        objectId: {
          type: 'string'
        },
        state: {
          type: 'object',
          properties: {
            position: {
              type: 'array'
            },
            velocity: {
              type: 'array'
            },
            rotation: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          action: 'create',
          objectId: 'example_value',
          properties: 'example_value',
          force: ['item1', 'item2'],
          deltaTime: 10
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              id: {
                type: 'string'
              },
              shape: {
                type: 'string'
              },
              bounds: {
                type: 'object'
              }
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
        success: {
          type: 'boolean'
        },
        collisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              objectA: {
                type: 'string'
              },
              objectB: {
                type: 'string'
              },
              point: {
                type: 'array'
              },
              normal: {
                type: 'array'
              },
              depth: {
                type: 'number'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          objects: ['item1', 'item2'],
          algorithm: 'aabb',
          continuous: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            distance: {
              type: 'number'
            },
            unit: {
              type: 'string'
            },
            method: {
              type: 'string'
            }
          }
        }
      },
      required: ['analysisType', 'inputData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'object',
          description: 'GeoJSON结果'
        },
        statistics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用空间分析器处理基础数据',
        params: {
          analysisType: 'buffer',
          inputData: 'example_value',
          parameters: 'example_value'
        }
      },
      {
        description: '使用空间分析器处理批量数据',
        params: {
          analysisType: 'buffer',
          inputData: 'example_value',
          parameters: 'example_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            lat: {
              type: 'number'
            },
            lon: {
              type: 'number'
            }
          }
        },
        end: {
          type: 'object',
          description: '终点坐标',
          properties: {
            lat: {
              type: 'number'
            },
            lon: {
              type: 'number'
            }
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
            avoid_tolls: {
              type: 'boolean'
            },
            avoid_highways: {
              type: 'boolean'
            },
            max_distance: {
              type: 'number'
            }
          }
        }
      },
      required: ['start', 'end']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        route: {
          type: 'object',
          properties: {
            path: {
              type: 'array'
            },
            distance: {
              type: 'number'
            },
            duration: {
              type: 'number'
            },
            steps: {
              type: 'array'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用路径规划器处理基础数据',
        params: {
          start: 'example_value',
          end: 'example_value',
          waypoints: ['item1', 'item2'],
          algorithm: 'dijkstra',
          constraints: 'example_value'
        }
      },
      {
        description: '使用路径规划器处理批量数据',
        params: {
          start: 'example_value',
          end: 'example_value',
          waypoints: ['item1', 'item2', 'item3', 'item4', 'item5'],
          algorithm: 'dijkstra',
          constraints: 'example_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
          items: {
            type: 'string'
          }
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
            match_score: {
              type: 'number'
            },
            mismatch_penalty: {
              type: 'number'
            },
            gap_penalty: {
              type: 'number'
            }
          }
        }
      },
      required: ['sequences', 'algorithm']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        alignment: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        score: {
          type: 'number'
        },
        identity: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用序列比对器',
        params: {
          sequences: ['item1', 'item2'],
          algorithm: 'needleman-wunsch',
          sequenceType: 'dna',
          parameters: 'value'
        }
      },
      {
        description: '高级序列比对器',
        params: {
          sequences: ['item1', 'item2', 'item3', 'item4'],
          algorithm: 'smith-waterman',
          sequenceType: 'rna',
          parameters: 'advanced_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        prediction: {
          type: 'object',
          properties: {
            structure: {
              type: 'string'
            },
            confidence: {
              type: 'number'
            },
            coordinates: {
              type: 'array'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '单次蛋白质结构预测器',
        params: {
          sequence: 'value',
          predictionType: 'secondary',
          method: 'alphafold'
        }
      },
      {
        description: '持续蛋白质结构预测器',
        params: {
          sequence: 'advanced_value',
          predictionType: 'tertiary',
          method: 'rosetta',
          continuous: true
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            cash_flows: {
              type: 'array'
            },
            discount_rate: {
              type: 'number'
            },
            initial_investment: {
              type: 'number'
            },
            risk_free_rate: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'object',
          properties: {
            value: {
              type: 'number'
            },
            npv: {
              type: 'number'
            },
            irr: {
              type: 'number'
            },
            payback_period: {
              type: 'number'
            }
          }
        },
        sensitivity_analysis: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用财务建模器处理基础数据',
        params: {
          modelType: 'dcf',
          inputs: 'example_value',
          assumptions: 'example_value'
        }
      },
      {
        description: '使用财务建模器处理批量数据',
        params: {
          modelType: 'dcf',
          inputs: 'example_value',
          assumptions: 'example_value'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              asset: {
                type: 'string'
              },
              weight: {
                type: 'number'
              },
              returns: {
                type: 'array'
              }
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
        success: {
          type: 'boolean'
        },
        risk_metrics: {
          type: 'object',
          properties: {
            var: {
              type: 'number'
            },
            cvar: {
              type: 'number'
            },
            sharpe_ratio: {
              type: 'number'
            },
            beta: {
              type: 'number'
            },
            volatility: {
              type: 'number'
            }
          }
        },
        recommendations: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用风险分析器处理基础数据',
        params: {
          portfolio: ['item1', 'item2'],
          riskMetrics: ['item1', 'item2'],
          confidence_level: 100,
          time_horizon: 100
        }
      },
      {
        description: '使用风险分析器处理批量数据',
        params: {
          portfolio: ['item1', 'item2', 'item3', 'item4', 'item5'],
          riskMetrics: ['item1', 'item2', 'item3', 'item4', 'item5'],
          confidence_level: 100,
          time_horizon: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string'
              },
              question: {
                type: 'string'
              },
              options: {
                type: 'array'
              },
              answer: {
                type: 'string'
              },
              explanation: {
                type: 'string'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用习题生成器',
        params: {
          subject: 'math',
          topic: 'value',
          difficulty: 'easy',
          count: 10,
          type: 'choice'
        }
      },
      {
        description: '高级习题生成器',
        params: {
          subject: 'physics',
          topic: 'advanced_value',
          difficulty: 'medium',
          count: 50,
          type: 'blank'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              student_id: {
                type: 'string'
              },
              answers: {
                type: 'array'
              }
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
            total_points: {
              type: 'number'
            },
            partial_credit: {
              type: 'boolean'
            }
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              student_id: {
                type: 'string'
              },
              score: {
                type: 'number'
              },
              feedback: {
                type: 'array'
              },
              strengths: {
                type: 'array'
              },
              weaknesses: {
                type: 'array'
              }
            }
          }
        },
        statistics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用自动批改器',
        params: {
          submissions: ['item1', 'item2'],
          answer_key: ['item1', 'item2'],
          grading_rubric: 'value',
          feedback_level: 'minimal'
        }
      },
      {
        description: '高级自动批改器',
        params: {
          submissions: ['item1', 'item2', 'item3', 'item4'],
          answer_key: ['item1', 'item2', 'item3', 'item4'],
          grading_rubric: 'advanced_value',
          feedback_level: 'standard'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string'
              },
              location: {
                type: 'object'
              },
              confidence: {
                type: 'number'
              },
              severity: {
                type: 'string'
              }
            }
          }
        },
        measurements: {
          type: 'object'
        },
        visualization: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用医学影像分析器',
        params: {
          imagePath: './data/sample.dat',
          imageType: 'ct',
          analysisType: 'lesion_detection',
          bodyPart: 'brain'
        }
      },
      {
        description: '高级医学影像分析器',
        params: {
          imagePath: './advanced_data/sample.dat',
          imageType: 'mri',
          analysisType: 'segmentation',
          bodyPart: 'chest'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            heart_rate: {
              type: 'number'
            },
            blood_pressure: {
              type: 'object'
            },
            temperature: {
              type: 'number'
            },
            sleep_hours: {
              type: 'number'
            },
            steps: {
              type: 'number'
            }
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
            age: {
              type: 'number'
            },
            gender: {
              type: 'string'
            },
            conditions: {
              type: 'array'
            }
          }
        }
      },
      required: ['metrics']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        analysis: {
          type: 'object',
          properties: {
            status: {
              type: 'string'
            },
            anomalies: {
              type: 'array'
            },
            trends: {
              type: 'object'
            }
          }
        },
        recommendations: {
          type: 'array'
        },
        risk_assessment: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用健康监测器',
        params: {
          metrics: 'value',
          history: ['item1', 'item2'],
          user_profile: './data/sample.dat'
        }
      },
      {
        description: '高级健康监测器',
        params: {
          metrics: 'advanced_value',
          history: ['item1', 'item2', 'item3', 'item4'],
          user_profile: './advanced_data/sample.dat'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
              name: {
                type: 'string'
              },
              role: {
                type: 'string'
              },
              address: {
                type: 'string'
              }
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
        success: {
          type: 'boolean'
        },
        document: {
          type: 'object',
          properties: {
            content: {
              type: 'string'
            },
            format: {
              type: 'string'
            },
            metadata: {
              type: 'object'
            }
          }
        },
        warnings: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用法律文书生成器',
        params: {
          documentType: 'contract',
          template: 'value',
          parties: ['item1', 'item2'],
          clauses: ['item1', 'item2'],
          jurisdiction: 'cn'
        }
      },
      {
        description: '高级法律文书生成器',
        params: {
          documentType: 'complaint',
          template: 'advanced_value',
          parties: ['item1', 'item2', 'item3', 'item4'],
          clauses: ['item1', 'item2', 'item3', 'item4'],
          jurisdiction: 'us'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            start: {
              type: 'string'
            },
            end: {
              type: 'string'
            }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            court: {
              type: 'string'
            },
            category: {
              type: 'string'
            }
          }
        }
      },
      required: ['query', 'searchType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string'
              },
              citation: {
                type: 'string'
              },
              summary: {
                type: 'string'
              },
              relevance: {
                type: 'number'
              },
              url: {
                type: 'string'
              }
            }
          }
        },
        total: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '搜索相关文档',
        params: {
          query: '如何使用API',
          index: 'knowledge_base',
          options: {
            top_k: 5,
            similarity_threshold: 0.7
          }
        }
      },
      {
        description: '语义搜索',
        params: {
          query: '智能合约安全问题',
          index: 'blockchain_docs',
          options: {
            semantic: true,
            top_k: 10
          }
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
              type: {
                type: 'string'
              },
              properties: {
                type: 'object'
              },
              geometry: {
                type: 'object'
              }
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        model: {
          type: 'object',
          properties: {
            path: {
              type: 'string'
            },
            elements_count: {
              type: 'number'
            },
            metadata: {
              type: 'object'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          action: 'create',
          modelPath: './data/sample.dat',
          format: 'ifc',
          elements: ['item1', 'item2']
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            type: {
              type: 'string'
            },
            materials: {
              type: 'array'
            },
            dimensions: {
              type: 'object'
            }
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
              type: {
                type: 'string'
              },
              magnitude: {
                type: 'number'
              },
              location: {
                type: 'object'
              }
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object',
          properties: {
            stress: {
              type: 'array'
            },
            displacement: {
              type: 'array'
            },
            safety_factor: {
              type: 'number'
            },
            critical_points: {
              type: 'array'
            }
          }
        },
        compliance: {
          type: 'boolean'
        },
        recommendations: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          structure: 'example_value',
          analysisType: 'static',
          loads: ['item1', 'item2'],
          standard: 'gb'
        }
      }
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
            location: {
              type: 'string'
            },
            time: {
              type: 'string'
            },
            device: {
              type: 'string'
            }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            categories: {
              type: 'array'
            },
            price_range: {
              type: 'object'
            },
            in_stock: {
              type: 'boolean'
            }
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
        success: {
          type: 'boolean'
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              item_id: {
                type: 'string'
              },
              score: {
                type: 'number'
              },
              reason: {
                type: 'string'
              },
              metadata: {
                type: 'object'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用推荐引擎处理基础数据',
        params: {
          userId: 'example_value',
          algorithm: 'collaborative',
          context: '这是一段示例文本',
          filters: 'example_value',
          limit: 10
        }
      },
      {
        description: '使用推荐引擎处理批量数据',
        params: {
          userId: 'example_value',
          algorithm: 'collaborative',
          context: '这是一段示例文本',
          filters: 'example_value',
          limit: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              sku: {
                type: 'string'
              },
              quantity: {
                type: 'number'
              },
              cost: {
                type: 'number'
              },
              sales_history: {
                type: 'array'
              }
            }
          }
        },
        parameters: {
          type: 'object',
          description: '管理参数',
          properties: {
            lead_time: {
              type: 'number'
            },
            service_level: {
              type: 'number'
            },
            holding_cost: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        result: {
          type: 'object',
          properties: {
            forecast: {
              type: 'array'
            },
            reorder_points: {
              type: 'object'
            },
            order_quantities: {
              type: 'object'
            },
            stockout_risk: {
              type: 'number'
            }
          }
        },
        recommendations: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用库存管理器处理基础数据',
        params: {
          action: 'forecast',
          inventory: ['item1', 'item2'],
          parameters: 'example_value',
          forecast_horizon: 100
        }
      },
      {
        description: '使用库存管理器处理批量数据',
        params: {
          action: 'forecast',
          inventory: ['item1', 'item2', 'item3', 'item4', 'item5'],
          parameters: 'example_value',
          forecast_horizon: 100
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            name: {
              type: 'string'
            },
            image: {
              type: 'string'
            },
            replicas: {
              type: 'number'
            },
            ports: {
              type: 'array'
            },
            env: {
              type: 'object'
            }
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
        success: {
          type: 'boolean'
        },
        deployment: {
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            status: {
              type: 'string'
            },
            replicas: {
              type: 'number'
            },
            ready: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '容器编排器使用示例',
        params: {
          action: 'deploy',
          service: 'example_value',
          namespace: 'example_value',
          cluster: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
            name: {
              type: 'string'
            },
            stages: {
              type: 'array'
            },
            triggers: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        pipeline_run: {
          type: 'object',
          properties: {
            id: {
              type: 'string'
            },
            status: {
              type: 'string'
            },
            stages: {
              type: 'array'
            },
            duration: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'CI/CD流水线使用示例',
        params: {
          action: 'create',
          pipeline: 'example_value',
          repository: 'example_value',
          branch: 'example_value'
        }
      }
    ],
    required_permissions: ['cicd:execute'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
              type: {
                type: 'string'
              },
              target: {
                type: 'number'
              },
              control: {
                type: 'number'
              },
              angle: {
                type: 'number'
              }
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
        success: {
          type: 'boolean'
        },
        circuit: {
          type: 'object',
          properties: {
            qubits: {
              type: 'number'
            },
            depth: {
              type: 'number'
            },
            gates: {
              type: 'array'
            },
            qasm: {
              type: 'string'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用量子电路构建器',
        params: {
          num_qubits: 10,
          gates: ['item1', 'item2'],
          measurements: ['item1', 'item2']
        }
      },
      {
        description: '高级量子电路构建器',
        params: {
          num_qubits: 50,
          gates: ['item1', 'item2', 'item3', 'item4'],
          measurements: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object',
          properties: {
            counts: {
              type: 'object'
            },
            statevector: {
              type: 'array'
            },
            probabilities: {
              type: 'object'
            }
          }
        },
        execution_time: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '简单量子模拟器',
        params: {
          circuit: 'value',
          shots: 10,
          backend: 'statevector',
          noise_model: 'base_model'
        }
      },
      {
        description: '复杂量子模拟器',
        params: {
          circuit: 'advanced_value',
          shots: 50,
          backend: 'qasm',
          noise_model: 'advanced_model_v2'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
              type: {
                type: 'string'
              },
              url: {
                type: 'string'
              },
              position: {
                type: 'array'
              },
              scale: {
                type: 'array'
              }
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
        success: {
          type: 'boolean'
        },
        scene: {
          type: 'object',
          properties: {
            id: {
              type: 'string'
            },
            url: {
              type: 'string'
            },
            preview: {
              type: 'string'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          contentType: '这是一段示例文本用于测试',
          assets: ['item1', 'item2'],
          interactions: ['item1', 'item2'],
          tracking: 'example_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            skybox: {
              type: 'string'
            },
            lighting: {
              type: 'object'
            },
            fog: {
              type: 'object'
            }
          }
        },
        objects: {
          type: 'array',
          description: '场景对象',
          items: {
            type: 'object',
            properties: {
              model: {
                type: 'string'
              },
              position: {
                type: 'array'
              },
              rotation: {
                type: 'array'
              },
              physics: {
                type: 'object'
              }
            }
          }
        },
        navigation: {
          type: 'object',
          description: '导航配置',
          properties: {
            type: {
              type: 'string'
            },
            speed: {
              type: 'number'
            }
          }
        }
      },
      required: ['environment']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        scene: {
          type: 'object',
          properties: {
            id: {
              type: 'string'
            },
            url: {
              type: 'string'
            },
            assets: {
              type: 'array'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          environment: 'example_value',
          objects: ['item1', 'item2'],
          navigation: 'example_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        model_id: {
          type: 'string'
        },
        audioPath: {
          type: 'string'
        },
        similarity_score: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          action: 'train',
          reference_audio: 'example_value',
          text: '这是一段示例文本用于测试',
          model_id: 'example_value',
          training_duration: 10
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
          items: {
            type: 'string'
          }
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
        success: {
          type: 'boolean'
        },
        detections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              class: {
                type: 'string'
              },
              confidence: {
                type: 'number'
              },
              bbox: {
                type: 'array'
              }
            }
          }
        },
        annotated_image: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基础目标检测器',
        params: {
          imagePath: './data/sample.dat',
          model: 'base_model',
          classes: ['item1', 'item2'],
          confidence_threshold: 0.5,
          nms_threshold: 0.5
        }
      },
      {
        description: '批量目标检测器',
        params: {
          imagePath: './advanced_data/sample.dat',
          model: 'advanced_model_v2',
          classes: ['item1', 'item2', 'item3', 'item4'],
          confidence_threshold: 0.8,
          nms_threshold: 0.8,
          batch: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        masks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              class: {
                type: 'string'
              },
              mask: {
                type: 'array'
              },
              area: {
                type: 'number'
              }
            }
          }
        },
        visualization: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用图像分割器',
        params: {
          imagePath: './data/sample.dat',
          segmentationType: 'semantic',
          model: 'base_model',
          classes: ['item1', 'item2']
        }
      },
      {
        description: '高级图像分割器',
        params: {
          imagePath: './advanced_data/sample.dat',
          segmentationType: 'instance',
          model: 'advanced_model_v2',
          classes: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
        success: {
          type: 'boolean'
        },
        testFiles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string'
              },
              tests_count: {
                type: 'number'
              }
            }
          }
        },
        estimated_coverage: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          sourcePath: './data/sample.dat',
          testType: 'unit',
          framework: 'jest',
          coverage_target: 10,
          mocking: false
        }
      },
      {
        description: '处理复杂项目',
        params: {
          sourcePath: './advanced_data/sample.dat',
          testType: 'integration',
          framework: 'mocha',
          coverage_target: 50,
          mocking: true
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            parallel: {
              type: 'boolean'
            },
            coverage: {
              type: 'boolean'
            },
            watch: {
              type: 'boolean'
            },
            timeout: {
              type: 'number'
            }
          }
        },
        filters: {
          type: 'object',
          description: '过滤条件',
          properties: {
            pattern: {
              type: 'string'
            },
            tags: {
              type: 'array'
            }
          }
        }
      },
      required: ['testPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object',
          properties: {
            total: {
              type: 'number'
            },
            passed: {
              type: 'number'
            },
            failed: {
              type: 'number'
            },
            skipped: {
              type: 'number'
            },
            duration: {
              type: 'number'
            }
          }
        },
        coverage: {
          type: 'object'
        },
        report_path: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          testPath: './data/sample.dat',
          framework: 'value',
          options: 'value',
          filters: 'value'
        }
      },
      {
        description: '处理复杂项目',
        params: {
          testPath: './advanced_data/sample.dat',
          framework: 'advanced_value',
          options: 'advanced_value',
          filters: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            id: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            body: {
              type: 'string'
            },
            author: {
              type: 'string'
            },
            tags: {
              type: 'array'
            },
            metadata: {
              type: 'object'
            }
          }
        },
        workflow: {
          type: 'object',
          description: '工作流配置',
          properties: {
            approval_required: {
              type: 'boolean'
            },
            reviewers: {
              type: 'array'
            }
          }
        },
        schedule: {
          type: 'object',
          description: '发布计划',
          properties: {
            publish_at: {
              type: 'string'
            },
            expire_at: {
              type: 'string'
            }
          }
        }
      },
      required: ['action', 'content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        content_id: {
          type: 'string'
        },
        status: {
          type: 'string'
        },
        version: {
          type: 'number'
        },
        url: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '内容发布器基础用法',
        params: {
          action: 'create',
          content: '示例文本',
          workflow: 'value',
          schedule: 'value'
        }
      },
      {
        description: '内容发布器高级用法',
        params: {
          action: 'update',
          content: '更复杂的示例文本内容，用于测试高级功能',
          workflow: 'advanced_value',
          schedule: 'advanced_value'
        }
      }
    ],
    required_permissions: ['content:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            path: {
              type: 'string'
            },
            type: {
              type: 'string'
            },
            size: {
              type: 'number'
            }
          }
        },
        transcode_options: {
          type: 'object',
          description: '转码选项',
          properties: {
            format: {
              type: 'string'
            },
            quality: {
              type: 'string'
            },
            resolution: {
              type: 'string'
            }
          }
        },
        cdn: {
          type: 'object',
          description: 'CDN配置',
          properties: {
            enabled: {
              type: 'boolean'
            },
            cache_ttl: {
              type: 'number'
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        file_id: {
          type: 'string'
        },
        url: {
          type: 'string'
        },
        cdn_url: {
          type: 'string'
        },
        metadata: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '媒体管理器基础用法',
        params: {
          action: 'upload',
          file: './data/sample.dat',
          transcode_options: 'value',
          cdn: 'value'
        }
      },
      {
        description: '媒体管理器高级用法',
        params: {
          action: 'transcode',
          file: './advanced_data/sample.dat',
          transcode_options: 'advanced_value',
          cdn: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
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
          items: {
            type: 'string'
          }
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
            start: {
              type: 'string'
            },
            end: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        sentiment: {
          type: 'object',
          properties: {
            positive: {
              type: 'number'
            },
            neutral: {
              type: 'number'
            },
            negative: {
              type: 'number'
            }
          }
        },
        trends: {
          type: 'array'
        },
        top_posts: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用舆情监控器处理基础数据',
        params: {
          keywords: ['item1', 'item2'],
          platforms: ['item1', 'item2'],
          timeRange: 'example_value',
          language: 'example_value'
        }
      },
      {
        description: '使用舆情监控器处理批量数据',
        params: {
          keywords: ['item1', 'item2', 'item3', 'item4', 'item5'],
          platforms: ['item1', 'item2', 'item3', 'item4', 'item5'],
          timeRange: 'example_value',
          language: 'example_value'
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        profile: {
          type: 'object',
          properties: {
            followers: {
              type: 'number'
            },
            engagement_rate: {
              type: 'number'
            },
            influence_score: {
              type: 'number'
            }
          }
        },
        audience_demographics: {
          type: 'object'
        },
        content_analysis: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用影响力分析器处理基础数据',
        params: {
          user_id: 'example_value',
          platform: 'twitter',
          metrics: ['item1', 'item2'],
          period: 100
        }
      },
      {
        description: '使用影响力分析器处理批量数据',
        params: {
          user_id: 'example_value',
          platform: 'twitter',
          metrics: ['item1', 'item2', 'item3', 'item4', 'item5'],
          period: 100
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
              id: {
                type: 'string'
              },
              lat: {
                type: 'number'
              },
              lon: {
                type: 'number'
              },
              demand: {
                type: 'number'
              }
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
            max_distance: {
              type: 'number'
            },
            time_windows: {
              type: 'array'
            },
            capacity: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        solution: {
          type: 'object',
          properties: {
            routes: {
              type: 'array'
            },
            total_cost: {
              type: 'number'
            },
            total_distance: {
              type: 'number'
            },
            vehicles_used: {
              type: 'number'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用物流优化器处理基础数据',
        params: {
          problem_type: 'vehicle_routing',
          locations: ['item1', 'item2'],
          vehicles: ['item1', 'item2'],
          constraints: 'example_value',
          optimization_goal: 'minimize_cost'
        }
      },
      {
        description: '使用物流优化器处理批量数据',
        params: {
          problem_type: 'vehicle_routing',
          locations: ['item1', 'item2', 'item3', 'item4', 'item5'],
          vehicles: ['item1', 'item2', 'item3', 'item4', 'item5'],
          constraints: 'example_value',
          optimization_goal: 'minimize_cost'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
              date: {
                type: 'string'
              },
              value: {
                type: 'number'
              }
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
              name: {
                type: 'string'
              },
              values: {
                type: 'array'
              }
            }
          }
        }
      },
      required: ['historical_data', 'forecast_horizon']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        forecast: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: {
                type: 'string'
              },
              predicted: {
                type: 'number'
              },
              lower_bound: {
                type: 'number'
              },
              upper_bound: {
                type: 'number'
              }
            }
          }
        },
        accuracy_metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用需求预测器处理基础数据',
        params: {
          historical_data: ['item1', 'item2'],
          forecast_horizon: 100,
          model: 'arima',
          external_factors: ['item1', 'item2']
        }
      },
      {
        description: '使用需求预测器处理批量数据',
        params: {
          historical_data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          forecast_horizon: 100,
          model: 'arima',
          external_factors: ['item1', 'item2', 'item3', 'item4', 'item5']
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            lat: {
              type: 'number'
            },
            lon: {
              type: 'number'
            }
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
            start: {
              type: 'string'
            },
            end: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        weather_data: {
          type: 'object',
          properties: {
            current: {
              type: 'object'
            },
            forecast: {
              type: 'array'
            },
            statistics: {
              type: 'object'
            }
          }
        },
        anomalies: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用气象分析器进行AI推理',
        params: {
          location: 'example_value',
          analysisType: 'current',
          timeRange: 'example_value',
          parameters: ['item1', 'item2']
        }
      },
      {
        description: '使用气象分析器批量处理',
        params: {
          location: 'example_value',
          analysisType: 'current',
          timeRange: 'example_value',
          parameters: ['item1', 'item2', 'item3', 'item4', 'item5']
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            enum: [
              'pm25',
              'pm10',
              'co2',
              'no2',
              'so2',
              'o3'
            ]
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
        success: {
          type: 'boolean'
        },
        current: {
          type: 'object',
          properties: {
            aqi: {
              type: 'number'
            },
            level: {
              type: 'string'
            },
            primary_pollutant: {
              type: 'string'
            }
          }
        },
        forecast: {
          type: 'array'
        },
        health_impact: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '单次污染预测器',
        params: {
          location: 'value',
          pollutionType: 'air',
          pollutants: ['item1', 'item2'],
          forecast_hours: 10,
          historical_data: ['item1', 'item2']
        }
      },
      {
        description: '持续污染预测器',
        params: {
          location: 'advanced_value',
          pollutionType: 'water',
          pollutants: ['item1', 'item2', 'item3', 'item4'],
          forecast_hours: 50,
          historical_data: ['item1', 'item2', 'item3', 'item4'],
          continuous: true
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            id: {
              type: 'string'
            },
            type: {
              type: 'string'
            },
            name: {
              type: 'string'
            },
            protocol: {
              type: 'string',
              enum: ['mqtt', 'coap', 'http']
            }
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
        success: {
          type: 'boolean'
        },
        device: {
          type: 'object'
        },
        devices: {
          type: 'array'
        },
        status: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'IoT设备管理器使用示例',
        params: {
          action: 'register',
          device: 'example_value',
          command: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        message_id: {
          type: 'string'
        },
        subscriptions: {
          type: 'array'
        },
        messages: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'MQTT消息代理使用示例',
        params: {
          action: 'publish',
          topic: 'example_value',
          message: '这是一段示例文本用于测试',
          qos: 0,
          retain: false
        }
      }
    ],
    required_permissions: ['network:mqtt'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            id: {
              type: 'string'
            },
            location: {
              type: 'string'
            },
            resources: {
              type: 'object'
            }
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
        success: {
          type: 'boolean'
        },
        node: {
          type: 'object'
        },
        nodes: {
          type: 'array'
        },
        metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '边缘节点管理器使用示例',
        params: {
          action: 'deploy',
          node: 'example_value',
          workload: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        predictions: {
          type: 'array'
        },
        latency_ms: {
          type: 'number'
        },
        confidence: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用边缘推理引擎',
        params: {
          model: 'base_model',
          input_data: 'value',
          format: 'onnx',
          device: 'cpu'
        }
      },
      {
        description: '高级边缘推理引擎',
        params: {
          model: 'advanced_model_v2',
          input_data: 'advanced_value',
          format: 'tflite',
          device: 'gpu'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            id: {
              type: 'string'
            },
            type: {
              type: 'string'
            },
            name: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        twin_id: {
          type: 'string'
        },
        model: {
          type: 'object'
        },
        visualization_url: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用数字孪生模型构建器',
        params: {
          entity: 'value',
          sensors: ['item1', 'item2'],
          parameters: 'value',
          physics_model: 'base_model'
        }
      },
      {
        description: '高级数字孪生模型构建器',
        params: {
          entity: 'advanced_value',
          sensors: ['item1', 'item2', 'item3', 'item4'],
          parameters: 'advanced_value',
          physics_model: 'advanced_model_v2'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object'
        },
        predictions: {
          type: 'array'
        },
        anomalies: {
          type: 'array'
        },
        metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '简单数字孪生仿真器',
        params: {
          twin_id: 'value',
          simulation_type: 'real_time',
          scenario: 'value',
          time_horizon: 10
        }
      },
      {
        description: '复杂数字孪生仿真器',
        params: {
          twin_id: 'advanced_value',
          simulation_type: 'predictive',
          scenario: 'advanced_value',
          time_horizon: 50
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            ip: {
              type: 'string'
            },
            type: {
              type: 'string',
              enum: ['siemens', 'allen_bradley', 'mitsubishi']
            },
            protocol: {
              type: 'string',
              enum: ['modbus', 's7', 'ethernet_ip']
            }
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
        success: {
          type: 'boolean'
        },
        data: {
          type: 'object'
        },
        status: {
          type: 'string'
        },
        diagnostics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'PLC控制器使用示例',
        params: {
          action: 'read',
          plc: 'example_value',
          address: 'example_value',
          value: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        schedule: {
          type: 'array'
        },
        gantt_chart: {
          type: 'object'
        },
        metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生产调度器基础用法',
        params: {
          orders: ['item1', 'item2'],
          resources: 'value',
          constraints: 'value',
          optimization_goal: 'minimize_time'
        }
      },
      {
        description: '生产调度器高级用法',
        params: {
          orders: ['item1', 'item2', 'item3', 'item4'],
          resources: 'advanced_value',
          constraints: 'advanced_value',
          optimization_goal: 'minimize_cost'
        }
      }
    ],
    required_permissions: ['data:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            name: {
              type: 'string'
            },
            triggers: {
              type: 'array'
            },
            conditions: {
              type: 'array'
            },
            actions: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        scene_id: {
          type: 'string'
        },
        scenes: {
          type: 'array'
        },
        execution_result: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '场景自动化器使用示例',
        params: {
          action: 'create',
          scene: 'example_value',
          scene_id: 'example_value'
        }
      }
    ],
    required_permissions: ['system:control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            name: {
              type: 'string'
            },
            source_device: {
              type: 'string'
            },
            source_event: {
              type: 'string'
            },
            target_devices: {
              type: 'array'
            },
            target_actions: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        linkage_id: {
          type: 'string'
        },
        linkages: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '设备联动器使用示例',
        params: {
          linkage: 'example_value',
          enabled: true
        }
      }
    ],
    required_permissions: ['system:control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            id: {
              type: 'string'
            },
            location: {
              type: 'object'
            },
            crop_type: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        status: {
          type: 'string'
        },
        detections: {
          type: 'array'
        },
        recommendations: {
          type: 'array'
        },
        yield_forecast: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用作物监测器',
        params: {
          field: 'value',
          monitoring_type: 'growth',
          images: ['item1', 'item2'],
          sensor_data: 'value'
        }
      },
      {
        description: '高级作物监测器',
        params: {
          field: 'advanced_value',
          monitoring_type: 'disease',
          images: ['item1', 'item2', 'item3', 'item4'],
          sensor_data: 'advanced_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            duration: {
              type: 'number'
            },
            flow_rate: {
              type: 'number'
            },
            schedule: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        status: {
          type: 'string'
        },
        schedule: {
          type: 'array'
        },
        water_usage: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '灌溉控制器使用示例',
        params: {
          action: 'start',
          zone: 'example_value',
          parameters: 'example_value',
          soil_moisture: 10,
          weather_forecast: 'example_value'
        }
      }
    ],
    required_permissions: ['system:control'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        signal_plan: {
          type: 'object'
        },
        metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '交通控制器使用示例',
        params: {
          intersection: 'example_value',
          mode: 'fixed',
          traffic_data: {
            key: 'value',
            enabled: true
          },
          optimization_goal: 'minimize_delay'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        events: {
          type: 'array'
        },
        alerts: {
          type: 'array'
        },
        threat_level: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用公共安全监控器进行AI处理',
        params: {
          area: 'example_value',
          monitoring_types: ['item1', 'item2'],
          alert_rules: ['item1', 'item2'],
          video_streams: ['item1', 'item2']
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
            a: {
              type: 'number',
              description: '半长轴(km)'
            },
            e: {
              type: 'number',
              description: '偏心率'
            },
            i: {
              type: 'number',
              description: '轨道倾角(度)'
            },
            omega: {
              type: 'number',
              description: '升交点赤经(度)'
            },
            w: {
              type: 'number',
              description: '近地点幅角(度)'
            },
            M: {
              type: 'number',
              description: '平近点角(度)'
            }
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
        success: {
          type: 'boolean'
        },
        trajectory: {
          type: 'array'
        },
        future_elements: {
          type: 'object'
        },
        ground_track: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用轨道计算器处理基础数据',
        params: {
          calculation_type: 'propagation',
          orbital_elements: 'example_value',
          time_span: 100,
          perturbations: ['item1', 'item2']
        }
      },
      {
        description: '使用轨道计算器处理批量数据',
        params: {
          calculation_type: 'propagation',
          orbital_elements: 'example_value',
          time_span: 100,
          perturbations: ['item1', 'item2', 'item3', 'item4', 'item5']
        }
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            airport: {
              type: 'string'
            },
            coordinates: {
              type: 'object'
            },
            time: {
              type: 'string'
            }
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
            type: {
              type: 'string'
            },
            cruise_speed: {
              type: 'number'
            },
            range: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        route: {
          type: 'array'
        },
        waypoints: {
          type: 'array'
        },
        flight_plan: {
          type: 'object'
        },
        estimates: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用飞行规划器处理基础数据',
        params: {
          departure: 'example_value',
          destination: 'example_value',
          aircraft: 'example_value',
          optimization: 'shortest',
          weather_data: 'example_value'
        }
      },
      {
        description: '使用飞行规划器处理批量数据',
        params: {
          departure: 'example_value',
          destination: 'example_value',
          aircraft: 'example_value',
          optimization: 'shortest',
          weather_data: 'example_value'
        }
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            coordinates: {
              type: 'array'
            },
            depth_range: {
              type: 'object'
            }
          }
        },
        monitoring_type: {
          type: 'string',
          description: '监测类型',
          enum: [
            'temperature',
            'salinity',
            'current',
            'wave',
            'biology',
            'pollution'
          ]
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
        success: {
          type: 'boolean'
        },
        measurements: {
          type: 'array'
        },
        analysis: {
          type: 'object'
        },
        visualization: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用海洋监测器',
        params: {
          area: 'value',
          monitoring_type: 'temperature',
          data_sources: ['item1', 'item2'],
          time_range: 'value'
        }
      },
      {
        description: '高级海洋监测器',
        params: {
          area: 'advanced_value',
          monitoring_type: 'salinity',
          data_sources: ['item1', 'item2', 'item3', 'item4'],
          time_range: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            type: {
              type: 'string'
            },
            draft: {
              type: 'number'
            },
            speed: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        route: {
          type: 'array'
        },
        waypoints: {
          type: 'array'
        },
        eta: {
          type: 'string'
        },
        distance: {
          type: 'number'
        },
        fuel_estimate: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用航海规划器处理基础数据',
        params: {
          departure: 'example_value',
          destination: 'example_value',
          vessel: 'example_value',
          optimization: 'shortest',
          constraints: 'example_value'
        }
      },
      {
        description: '使用航海规划器处理批量数据',
        params: {
          departure: 'example_value',
          destination: 'example_value',
          vessel: 'example_value',
          optimization: 'shortest',
          constraints: 'example_value'
        }
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        dispatch_plan: {
          type: 'array'
        },
        total_cost: {
          type: 'number'
        },
        emissions: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '电力调度器使用示例',
        params: {
          grid: 'example_value',
          generators: ['item1', 'item2'],
          load_forecast: 'example_value',
          optimization: 'minimize_cost',
          constraints: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        forecast: {
          type: 'array'
        },
        confidence_intervals: {
          type: 'array'
        },
        total_generation: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '单次新能源预测器',
        params: {
          energy_type: 'solar',
          location: 'value',
          capacity: 10,
          forecast_horizon: 10,
          historical_data: ['item1', 'item2'],
          weather_forecast: 'value'
        }
      },
      {
        description: '持续新能源预测器',
        params: {
          energy_type: 'wind',
          location: 'advanced_value',
          capacity: 50,
          forecast_horizon: 50,
          historical_data: ['item1', 'item2', 'item3', 'item4'],
          weather_forecast: 'advanced_value',
          continuous: true
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
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
            distance: {
              type: 'number'
            },
            loss_db: {
              type: 'number'
            },
            noise: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        key: {
          type: 'string'
        },
        qber: {
          type: 'number'
        },
        secure: {
          type: 'boolean'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '量子密钥分发器使用示例',
        params: {
          protocol: 'BB84',
          key_length: 10,
          channel: 'example_value',
          error_correction: true
        }
      }
    ],
    required_permissions: ['security:encryption'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            alpha: {
              type: 'number'
            },
            beta: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        fidelity: {
          type: 'number'
        },
        measurement_results: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用量子隐形传态器',
        params: {
          quantum_state: 'value',
          entanglement_quality: 10,
          classical_channel: 'value'
        }
      },
      {
        description: '高级量子隐形传态器',
        params: {
          quantum_state: 'advanced_value',
          entanglement_quality: 50,
          classical_channel: 'advanced_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            filter: {
              type: 'string',
              enum: ['bandpass', 'notch', 'highpass']
            },
            artifact_removal: {
              type: 'boolean'
            },
            feature_extraction: {
              type: 'array'
            }
          }
        }
      },
      required: ['eeg_data', 'sampling_rate']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        processed_data: {
          type: 'array'
        },
        features: {
          type: 'object'
        },
        quality_metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用脑电信号处理器进行AI推理',
        params: {
          eeg_data: ['item1', 'item2'],
          sampling_rate: 100,
          channels: ['item1', 'item2'],
          processing: 'example_value'
        }
      },
      {
        description: '使用脑电信号处理器批量处理',
        params: {
          eeg_data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          sampling_rate: 100,
          channels: ['item1', 'item2', 'item3', 'item4', 'item5'],
          processing: 'example_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        intent: {
          type: 'string'
        },
        confidence: {
          type: 'number'
        },
        probabilities: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用脑机接口解码器',
        params: {
          features: 'value',
          task_type: 'motor_imagery',
          model: 'base_model',
          calibration_data: ['item1', 'item2']
        }
      },
      {
        description: '高级脑机接口解码器',
        params: {
          features: 'advanced_value',
          task_type: 'p300',
          model: 'advanced_model_v2',
          calibration_data: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        grna_sequences: {
          type: 'array'
        },
        off_targets: {
          type: 'array'
        },
        efficiency_score: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用基因编辑器进行AI处理',
        params: {
          target_gene: 'example_value',
          edit_type: 'knockout',
          editor: 'Cas9',
          pam_sequence: 'example_value',
          grna_design: 'example_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
            binding_target: {
              type: 'string'
            },
            catalytic_residues: {
              type: 'array'
            }
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
        success: {
          type: 'boolean'
        },
        sequence: {
          type: 'string'
        },
        structure: {
          type: 'object'
        },
        stability_score: {
          type: 'number'
        },
        function_score: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用蛋白质设计器',
        params: {
          design_goal: 'enzyme',
          sequence: 'value',
          structure_constraints: 'value',
          function_requirements: 'value',
          optimization_cycles: 10
        }
      },
      {
        description: '高级蛋白质设计器',
        params: {
          design_goal: 'antibody',
          sequence: 'advanced_value',
          structure_constraints: 'advanced_value',
          function_requirements: 'advanced_value',
          optimization_cycles: 50
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            atoms: {
              type: 'array'
            },
            lattice: {
              type: 'object'
            },
            temperature: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        trajectory: {
          type: 'array'
        },
        energy: {
          type: 'number'
        },
        properties: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '简单纳米模拟器',
        params: {
          system: 'value',
          method: 'MD',
          simulation_time: 10,
          force_field: 'LAMMPS'
        }
      },
      {
        description: '复杂纳米模拟器',
        params: {
          system: 'advanced_value',
          method: 'MC',
          simulation_time: 50,
          force_field: 'AMBER'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            resolution: {
              type: 'number'
            },
            temperature: {
              type: 'number'
            },
            pressure: {
              type: 'number'
            }
          }
        }
      },
      required: ['process', 'pattern']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        fabrication_plan: {
          type: 'object'
        },
        yield_estimate: {
          type: 'number'
        },
        defects: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '纳米加工器使用示例',
        params: {
          process: 'lithography',
          pattern: 'example_value',
          materials: ['item1', 'item2'],
          parameters: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        keff: {
          type: 'number'
        },
        power_distribution: {
          type: 'array'
        },
        temperature_distribution: {
          type: 'array'
        },
        safety_parameters: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用反应堆模拟器进行AI处理',
        params: {
          reactor_type: 'PWR',
          power_level: 10,
          fuel_composition: 'example_value',
          control_rods: 'example_value',
          simulation_type: 'steady_state'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        dose_rate: {
          type: 'number'
        },
        nuclides: {
          type: 'array'
        },
        alarm_level: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '辐射监测器使用示例',
        params: {
          detector_type: 'GM',
          measurement_type: 'dose_rate',
          location: 'example_value',
          background: 10
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            imu: {
              type: 'object'
            },
            dvl: {
              type: 'object'
            },
            depth: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        position: {
          type: 'object'
        },
        velocity: {
          type: 'object'
        },
        accuracy: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用水下导航器处理基础数据',
        params: {
          navigation_mode: 'INS',
          sensor_data: 'example_value',
          initial_position: 'example_value',
          current: 'example_value'
        }
      },
      {
        description: '使用水下导航器处理批量数据',
        params: {
          navigation_mode: 'INS',
          sensor_data: 'example_value',
          initial_position: 'example_value',
          current: 'example_value'
        }
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            bounds: {
              type: 'array'
            },
            depth_range: {
              type: 'object'
            }
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
        success: {
          type: 'boolean'
        },
        bathymetry: {
          type: 'array'
        },
        features: {
          type: 'array'
        },
        coverage: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用深海测绘器处理基础数据',
        params: {
          sonar_type: 'multibeam',
          survey_area: 'example_value',
          resolution: 100,
          raw_data: ['item1', 'item2']
        }
      },
      {
        description: '使用深海测绘器处理批量数据',
        params: {
          sonar_type: 'multibeam',
          survey_area: 'example_value',
          resolution: 100,
          raw_data: ['item1', 'item2', 'item3', 'item4', 'item5']
        }
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
        success: {
          type: 'boolean'
        },
        composition: {
          type: 'object'
        },
        resources: {
          type: 'object'
        },
        value_estimate: {
          type: 'number'
        },
        accessibility: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用小行星分析器进行AI推理',
        params: {
          asteroid_id: 'example_value',
          analysis_type: 'composition',
          spectral_data: ['item1', 'item2'],
          orbital_elements: 'example_value'
        }
      },
      {
        description: '使用小行星分析器批量处理',
        params: {
          asteroid_id: 'example_value',
          analysis_type: 'composition',
          spectral_data: ['item1', 'item2', 'item3', 'item4', 'item5'],
          orbital_elements: 'example_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            coordinates: {
              type: 'object'
            },
            terrain: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        mining_plan: {
          type: 'object'
        },
        yield_estimate: {
          type: 'number'
        },
        energy_required: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '月球采矿器使用示例',
        params: {
          site: 'example_value',
          target_resource: 'water_ice',
          equipment: ['item1', 'item2'],
          extraction_method: 'excavation'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
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
            cloud_type: {
              type: 'string'
            },
            temperature: {
              type: 'number'
            },
            humidity: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        flight_plan: {
          type: 'object'
        },
        dosage: {
          type: 'number'
        },
        effectiveness_estimate: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '云播种器使用示例',
        params: {
          operation_type: 'precipitation_enhancement',
          seeding_agent: 'silver_iodide',
          target_area: 'example_value',
          weather_conditions: 'example_value',
          aircraft: 'example_value'
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
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
            bounds: {
              type: 'array'
            },
            resolution: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        forecast: {
          type: 'object'
        },
        fields: {
          type: 'array'
        },
        uncertainty: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '简单天气建模器',
        params: {
          model: 'base_model',
          domain: 'value',
          initial_conditions: 'value',
          forecast_hours: 10,
          physics_options: 'value'
        }
      },
      {
        description: '复杂天气建模器',
        params: {
          model: 'advanced_model_v2',
          domain: 'advanced_value',
          initial_conditions: 'advanced_value',
          forecast_hours: 50,
          physics_options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            strength: {
              type: 'number'
            },
            conductivity: {
              type: 'number'
            },
            density: {
              type: 'number'
            }
          }
        },
        constraints: {
          type: 'object',
          description: '约束条件',
          properties: {
            elements: {
              type: 'array'
            },
            cost: {
              type: 'number'
            },
            toxicity: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        compositions: {
          type: 'array'
        },
        predicted_properties: {
          type: 'object'
        },
        synthesis_route: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用材料设计器',
        params: {
          material_class: 'metal',
          target_properties: 'value',
          constraints: 'value',
          design_method: 'ML'
        }
      },
      {
        description: '高级材料设计器',
        params: {
          material_class: 'ceramic',
          target_properties: 'advanced_value',
          constraints: 'advanced_value',
          design_method: 'DFT'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            composition: {
              type: 'string'
            },
            structure: {
              type: 'object'
            }
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
        success: {
          type: 'boolean'
        },
        predictions: {
          type: 'object'
        },
        confidence: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '单次性能预测器',
        params: {
          material: 'value',
          properties: ['item1', 'item2'],
          method: 'ML'
        }
      },
      {
        description: '持续性能预测器',
        params: {
          material: 'advanced_value',
          properties: ['item1', 'item2', 'item3', 'item4'],
          method: 'DFT',
          continuous: true
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            layers: {
              type: 'array'
            },
            neuron_model: {
              type: 'string',
              enum: ['LIF', 'Izhikevich', 'AdEx']
            },
            topology: {
              type: 'string'
            }
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
        success: {
          type: 'boolean'
        },
        model_id: {
          type: 'string'
        },
        performance: {
          type: 'object'
        },
        spike_statistics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用脉冲神经网络构建器',
        params: {
          architecture: 'value',
          learning_rule: 'STDP',
          encoding: 'rate',
          training_data: ['item1', 'item2']
        }
      },
      {
        description: '高级脉冲神经网络构建器',
        params: {
          architecture: 'advanced_value',
          learning_rule: 'R-STDP',
          encoding: 'temporal',
          training_data: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
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
            power_mode: {
              type: 'string',
              enum: ['low', 'balanced', 'high']
            },
            latency_target: {
              type: 'number'
            }
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
        success: {
          type: 'boolean'
        },
        output: {
          type: 'object'
        },
        latency_ms: {
          type: 'number'
        },
        power_consumption: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '神经形态加速器使用示例',
        params: {
          hardware: 'Loihi',
          model: 'example_value',
          optimization: 'example_value',
          input_data: {
            key: 'value',
            enabled: true
          }
        }
      }
    ],
    required_permissions: ['system:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_ligo_data_analyzer',
    name: 'ligo_data_analyzer',
    display_name: 'LIGO数据分析器',
    description: '引力波探测器数据分析和信号处理',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        detector: {
          type: 'string',
          description: '探测器',
          enum: ['LIGO-Hanford', 'LIGO-Livingston', 'Virgo', 'KAGRA']
        },
        data_segment: {
          type: 'object',
          description: '数据段',
          properties: {
            start_gps: {
              type: 'number',
              description: 'GPS开始时间'
            },
            duration: {
              type: 'number',
              description: '持续时间(秒)'
            }
          },
          required: ['start_gps', 'duration']
        },
        preprocessing: {
          type: 'object',
          description: '预处理选项',
          properties: {
            whitening: {
              type: 'boolean',
              description: '白化处理'
            },
            bandpass: {
              type: 'object',
              properties: {
                low_freq: {
                  type: 'number'
                },
                high_freq: {
                  type: 'number'
                }
              }
            },
            notch_filters: {
              type: 'array',
              items: {
                type: 'number'
              }
            }
          }
        },
        analysis_method: {
          type: 'string',
          description: '分析方法',
          enum: ['matched_filter', 'burst', 'stochastic', 'continuous']
        }
      },
      required: ['detector', 'data_segment', 'analysis_method']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        strain_data: {
          type: 'array',
          description: '应变数据'
        },
        psd: {
          type: 'object',
          description: '功率谱密度'
        },
        triggers: {
          type: 'array',
          description: '触发事件'
        },
        quality_flags: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'LIGO数据分析器使用示例',
        params: {
          detector: 'LIGO-Hanford',
          data_segment: {
            key: 'value',
            enabled: true
          },
          preprocessing: 'example_value',
          analysis_method: 'matched_filter'
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_waveform_matcher',
    name: 'waveform_matcher',
    display_name: '引力波波形匹配器',
    description: '模板匹配和参数估计',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        strain_data: {
          type: 'array',
          description: '应变数据'
        },
        template_bank: {
          type: 'object',
          description: '模板库',
          properties: {
            mass_range: {
              type: 'object',
              properties: {
                m1_min: {
                  type: 'number'
                },
                m1_max: {
                  type: 'number'
                },
                m2_min: {
                  type: 'number'
                },
                m2_max: {
                  type: 'number'
                }
              }
            },
            spin_range: {
              type: 'object'
            }
          }
        },
        search_params: {
          type: 'object',
          description: '搜索参数',
          properties: {
            snr_threshold: {
              type: 'number',
              description: '信噪比阈值'
            },
            chi_squared_threshold: {
              type: 'number'
            }
          }
        },
        parameter_estimation: {
          type: 'boolean',
          description: '是否进行参数估计'
        }
      },
      required: ['strain_data', 'template_bank']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              snr: {
                type: 'number'
              },
              chirp_mass: {
                type: 'number'
              },
              total_mass: {
                type: 'number'
              },
              distance_mpc: {
                type: 'number'
              },
              merger_time: {
                type: 'number'
              }
            }
          }
        },
        best_match_params: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '引力波波形匹配器使用示例',
        params: {
          strain_data: {
            key: 'value',
            enabled: true
          },
          template_bank: 'example_value',
          search_params: 'example_value',
          parameter_estimation: true
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_particle_simulator',
    name: 'particle_simulator',
    display_name: '粒子碰撞模拟器',
    description: '高能粒子碰撞模拟',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        collider: {
          type: 'string',
          description: '对撞机',
          enum: ['LHC', 'Tevatron', 'RHIC', 'ILC', 'FCC']
        },
        collision_energy: {
          type: 'number',
          description: '碰撞能量(TeV)'
        },
        beam_particles: {
          type: 'object',
          description: '束流粒子',
          properties: {
            particle1: {
              type: 'string',
              enum: ['proton', 'electron', 'positron', 'heavy_ion']
            },
            particle2: {
              type: 'string',
              enum: ['proton', 'electron', 'positron', 'heavy_ion']
            }
          }
        },
        process: {
          type: 'string',
          description: '物理过程',
          enum: ['Higgs_production', 'top_pair', 'SUSY', 'exotic', 'QCD']
        },
        num_events: {
          type: 'number',
          description: '事例数'
        },
        detector_simulation: {
          type: 'boolean',
          description: '是否模拟探测器响应'
        }
      },
      required: ['collider', 'collision_energy', 'process']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        events: {
          type: 'array',
          description: '事例列表'
        },
        cross_section: {
          type: 'number',
          description: '截面(pb)'
        },
        kinematics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '粒子碰撞模拟器使用示例',
        params: {
          collider: 'LHC',
          collision_energy: 10,
          beam_particles: 'example_value',
          process: 'Higgs_production',
          num_events: 10,
          detector_simulation: true
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_event_generator',
    name: 'event_generator',
    display_name: '粒子事例生成器',
    description: 'Monte Carlo事例生成',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        generator: {
          type: 'string',
          description: '生成器',
          enum: ['Pythia', 'Herwig', 'Sherpa', 'MadGraph']
        },
        process: {
          type: 'string',
          description: '物理过程'
        },
        pdf_set: {
          type: 'string',
          description: 'PDF集合',
          enum: ['NNPDF', 'CT18', 'MMHT2014']
        },
        hadronization: {
          type: 'object',
          description: '强子化模型',
          properties: {
            model: {
              type: 'string',
              enum: ['string', 'cluster']
            },
            tune: {
              type: 'string'
            }
          }
        },
        cuts: {
          type: 'object',
          description: '运动学切割',
          properties: {
            pt_min: {
              type: 'number'
            },
            eta_max: {
              type: 'number'
            },
            invariant_mass_range: {
              type: 'array'
            }
          }
        },
        num_events: {
          type: 'number',
          description: '生成事例数'
        }
      },
      required: ['generator', 'process', 'num_events']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              event_id: {
                type: 'number'
              },
              particles: {
                type: 'array'
              },
              weight: {
                type: 'number'
              }
            }
          }
        },
        histograms: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '粒子事例生成器使用示例',
        params: {
          generator: 'Pythia',
          process: 'example_value',
          pdf_set: 'NNPDF',
          hadronization: 'example_value',
          cuts: 'example_value',
          num_events: 10
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_wimp_detector',
    name: 'wimp_detector',
    display_name: 'WIMP探测器',
    description: '弱相互作用大质量粒子直接探测',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        detector_type: {
          type: 'string',
          description: '探测器类型',
          enum: ['xenon_TPC', 'germanium', 'scintillator', 'bubble_chamber']
        },
        target_material: {
          type: 'string',
          description: '靶材料',
          enum: ['Xe', 'Ge', 'Ar', 'Si', 'NaI']
        },
        exposure: {
          type: 'object',
          description: '曝光量',
          properties: {
            mass_kg: {
              type: 'number'
            },
            time_days: {
              type: 'number'
            }
          }
        },
        energy_threshold: {
          type: 'number',
          description: '能量阈值(keV)'
        },
        background_model: {
          type: 'object',
          description: '本底模型',
          properties: {
            radon: {
              type: 'number'
            },
            cosmogenic: {
              type: 'number'
            },
            neutron: {
              type: 'number'
            }
          }
        },
        wimp_params: {
          type: 'object',
          description: 'WIMP参数',
          properties: {
            mass_gev: {
              type: 'number'
            },
            cross_section: {
              type: 'number'
            }
          }
        }
      },
      required: ['detector_type', 'target_material', 'exposure']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        events: {
          type: 'array',
          description: '候选事例'
        },
        exclusion_limit: {
          type: 'object',
          description: '排除限'
        },
        significance: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'WIMP探测器使用示例',
        params: {
          detector_type: 'xenon_TPC',
          target_material: 'Xe',
          exposure: 'example_value',
          energy_threshold: 10,
          background_model: 'example_value',
          wimp_params: 'example_value'
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_axion_searcher',
    name: 'axion_searcher',
    display_name: '轴子搜寻器',
    description: '轴子暗物质搜寻',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        search_method: {
          type: 'string',
          description: '搜寻方法',
          enum: ['cavity_haloscope', 'helioscope', 'light_shining']
        },
        mass_range: {
          type: 'object',
          description: '质量范围(μeV)',
          properties: {
            min: {
              type: 'number'
            },
            max: {
              type: 'number'
            }
          }
        },
        cavity_params: {
          type: 'object',
          description: '腔体参数',
          properties: {
            frequency_ghz: {
              type: 'number'
            },
            quality_factor: {
              type: 'number'
            },
            volume_liters: {
              type: 'number'
            }
          }
        },
        magnetic_field: {
          type: 'number',
          description: '磁场强度(T)'
        },
        integration_time: {
          type: 'number',
          description: '积分时间(hours)'
        },
        coupling_constant: {
          type: 'number',
          description: '耦合常数g_aγγ'
        }
      },
      required: ['search_method', 'mass_range']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        signal_power: {
          type: 'number',
          description: '信号功率(W)'
        },
        sensitivity: {
          type: 'number'
        },
        exclusion_plot: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '轴子搜寻器使用示例',
        params: {
          search_method: 'cavity_haloscope',
          mass_range: 'example_value',
          cavity_params: 'example_value',
          magnetic_field: 10,
          integration_time: 10,
          coupling_constant: 10
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_tokamak_simulator',
    name: 'tokamak_simulator',
    display_name: '托卡马克模拟器',
    description: '托卡马克等离子体模拟',
    category: 'energy',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: '装置',
          enum: ['ITER', 'EAST', 'JET', 'SPARC', 'DEMO']
        },
        plasma_params: {
          type: 'object',
          description: '等离子体参数',
          properties: {
            major_radius: {
              type: 'number',
              description: '大半径(m)'
            },
            minor_radius: {
              type: 'number',
              description: '小半径(m)'
            },
            toroidal_field: {
              type: 'number',
              description: '环向磁场(T)'
            },
            plasma_current: {
              type: 'number',
              description: '等离子体电流(MA)'
            }
          }
        },
        operating_scenario: {
          type: 'string',
          description: '运行模式',
          enum: ['L-mode', 'H-mode', 'I-mode', 'advanced']
        },
        heating_systems: {
          type: 'object',
          description: '加热系统',
          properties: {
            nbi_power: {
              type: 'number',
              description: 'NBI功率(MW)'
            },
            ec_power: {
              type: 'number',
              description: 'EC功率(MW)'
            },
            ic_power: {
              type: 'number',
              description: 'IC功率(MW)'
            }
          }
        },
        simulation_type: {
          type: 'string',
          description: '模拟类型',
          enum: ['equilibrium', 'transport', 'stability', 'disruption']
        },
        duration: {
          type: 'number',
          description: '模拟时长(s)'
        }
      },
      required: ['device', 'plasma_params', 'simulation_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        fusion_power: {
          type: 'number',
          description: '聚变功率(MW)'
        },
        q_factor: {
          type: 'number',
          description: '能量增益因子Q'
        },
        confinement_time: {
          type: 'number',
          description: '约束时间(s)'
        },
        beta: {
          type: 'number',
          description: 'β值'
        },
        profiles: {
          type: 'object',
          description: '剖面'
        },
        stability: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '托卡马克模拟器使用示例',
        params: {
          device: 'ITER',
          plasma_params: 'example_value',
          operating_scenario: 'L-mode',
          heating_systems: 'example_value',
          simulation_type: 'equilibrium',
          duration: 10
        }
      }
    ],
    required_permissions: ['energy:nuclear'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_plasma_controller',
    name: 'plasma_controller',
    display_name: '等离子体控制器',
    description: '等离子体位形和稳定性控制',
    category: 'energy',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        control_objectives: {
          type: 'object',
          description: '控制目标',
          properties: {
            vertical_position: {
              type: 'number'
            },
            elongation: {
              type: 'number'
            },
            triangularity: {
              type: 'number'
            },
            q95: {
              type: 'number'
            }
          }
        },
        actuators: {
          type: 'object',
          description: '执行器',
          properties: {
            poloidal_field_coils: {
              type: 'array',
              description: 'PF线圈电流'
            },
            neutral_beam: {
              type: 'number'
            },
            gas_puffing: {
              type: 'number'
            }
          }
        },
        controller_type: {
          type: 'string',
          description: '控制器类型',
          enum: ['PID', 'model_predictive', 'neural_network', 'fuzzy']
        },
        feedback_sensors: {
          type: 'array',
          description: '反馈传感器',
          items: {
            type: 'string'
          }
        },
        constraints: {
          type: 'object',
          description: '约束条件',
          properties: {
            max_coil_current: {
              type: 'number'
            },
            max_power: {
              type: 'number'
            }
          }
        }
      },
      required: ['control_objectives', 'controller_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        control_signals: {
          type: 'object'
        },
        plasma_state: {
          type: 'object'
        },
        stability_margin: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '等离子体控制器使用示例',
        params: {
          control_objectives: 'example_value',
          actuators: 'example_value',
          controller_type: 'PID',
          feedback_sensors: ['item1', 'item2'],
          constraints: 'example_value'
        }
      }
    ],
    required_permissions: ['energy:nuclear'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_photonic_router',
    name: 'photonic_router',
    display_name: '光子路由器',
    description: '全光网络路由和交换',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        architecture: {
          type: 'string',
          description: '架构',
          enum: ['wavelength_routing', 'optical_burst', 'optical_packet']
        },
        wavelength_channels: {
          type: 'number',
          description: '波长信道数'
        },
        switching_technology: {
          type: 'string',
          description: '交换技术',
          enum: ['MEMS', 'SOA', 'electro_optic', 'thermo_optic']
        },
        modulation_format: {
          type: 'string',
          description: '调制格式',
          enum: ['OOK', 'DPSK', 'QPSK', 'QAM16', 'QAM64']
        },
        routing_table: {
          type: 'array',
          description: '路由表',
          items: {
            type: 'object',
            properties: {
              source: {
                type: 'string'
              },
              destination: {
                type: 'string'
              },
              wavelength: {
                type: 'number'
              }
            }
          }
        },
        qos_requirements: {
          type: 'object',
          description: 'QoS要求',
          properties: {
            latency_ms: {
              type: 'number'
            },
            bandwidth_gbps: {
              type: 'number'
            },
            ber_threshold: {
              type: 'number'
            }
          }
        }
      },
      required: ['architecture', 'wavelength_channels']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        routes: {
          type: 'array'
        },
        wavelength_assignment: {
          type: 'object'
        },
        throughput_gbps: {
          type: 'number'
        },
        blocking_probability: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络光子路由器',
        params: {
          architecture: 'wavelength_routing',
          wavelength_channels: 10,
          switching_technology: 'MEMS',
          modulation_format: 'OOK',
          routing_table: ['item1', 'item2'],
          qos_requirements: 'value'
        }
      },
      {
        description: '高级网络光子路由器',
        params: {
          architecture: 'optical_burst',
          wavelength_channels: 50,
          switching_technology: 'SOA',
          modulation_format: 'DPSK',
          routing_table: ['item1', 'item2', 'item3', 'item4'],
          qos_requirements: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:admin'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_optical_nn_designer',
    name: 'optical_nn_designer',
    display_name: '光学神经网络设计器',
    description: '光学神经网络架构设计',
    category: 'ai',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        architecture: {
          type: 'string',
          description: '架构类型',
          enum: ['diffractive', 'interferometric', 'reservoir', 'hybrid']
        },
        layers: {
          type: 'array',
          description: '网络层',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['phase_mask', 'mzi_mesh', 'free_space']
              },
              size: {
                type: 'number'
              }
            }
          }
        },
        optical_components: {
          type: 'object',
          description: '光学元件',
          properties: {
            wavelength_nm: {
              type: 'number'
            },
            nonlinearity: {
              type: 'string',
              enum: ['none', 'saturable_absorber', 'kerr']
            }
          }
        },
        training_method: {
          type: 'string',
          description: '训练方法',
          enum: ['in_situ', 'digital_twin', 'hybrid']
        },
        task: {
          type: 'string',
          description: '任务类型',
          enum: ['classification', 'regression', 'generation']
        },
        dataset: {
          type: 'object',
          description: '数据集'
        }
      },
      required: ['architecture', 'layers']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        model_id: {
          type: 'string'
        },
        performance: {
          type: 'object'
        },
        power_consumption_mw: {
          type: 'number'
        },
        latency_ns: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用光学神经网络设计器',
        params: {
          architecture: 'diffractive',
          layers: ['item1', 'item2'],
          optical_components: 'value',
          training_method: 'in_situ',
          task: 'classification',
          dataset: 'value'
        }
      },
      {
        description: '高级光学神经网络设计器',
        params: {
          architecture: 'interferometric',
          layers: ['item1', 'item2', 'item3', 'item4'],
          optical_components: 'advanced_value',
          training_method: 'digital_twin',
          task: 'regression',
          dataset: 'advanced_value'
        }
      }
    ],
    required_permissions: ['ai:inference'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_topological_state_calculator',
    name: 'topological_state_calculator',
    display_name: '拓扑态计算器',
    description: '拓扑不变量和能带结构计算',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        material: {
          type: 'object',
          description: '材料信息',
          properties: {
            lattice: {
              type: 'string',
              description: '晶格类型'
            },
            atoms: {
              type: 'array'
            },
            symmetry: {
              type: 'string'
            }
          }
        },
        hamiltonian: {
          type: 'object',
          description: '哈密顿量',
          properties: {
            tight_binding: {
              type: 'object'
            },
            spin_orbit_coupling: {
              type: 'number'
            }
          }
        },
        topological_invariant: {
          type: 'string',
          description: '拓扑不变量',
          enum: ['chern_number', 'z2_invariant', 'winding_number', 'berry_phase']
        },
        k_points: {
          type: 'object',
          description: 'k点网格',
          properties: {
            grid: {
              type: 'array'
            },
            path: {
              type: 'array',
              description: '高对称路径'
            }
          }
        },
        calculation_method: {
          type: 'string',
          description: '计算方法',
          enum: ['wannier', 'berry_curvature', 'edge_states']
        }
      },
      required: ['material', 'topological_invariant']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        invariant_value: {
          type: 'number'
        },
        band_structure: {
          type: 'object'
        },
        edge_states: {
          type: 'array'
        },
        topological_phase: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '拓扑态计算器使用示例',
        params: {
          material: 'example_value',
          hamiltonian: 'example_value',
          topological_invariant: 'chern_number',
          k_points: 'example_value',
          calculation_method: 'wannier'
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_majorana_detector',
    name: 'majorana_detector',
    display_name: '马约拉纳费米子探测器',
    description: '马约拉纳零能模探测',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        system_type: {
          type: 'string',
          description: '系统类型',
          enum: ['nanowire', 'vortex', 'edge_state', 'junction']
        },
        experimental_setup: {
          type: 'object',
          description: '实验装置',
          properties: {
            temperature_mk: {
              type: 'number',
              description: '温度(mK)'
            },
            magnetic_field_t: {
              type: 'number'
            },
            gate_voltages: {
              type: 'array'
            }
          }
        },
        measurement_type: {
          type: 'string',
          description: '测量类型',
          enum: ['tunneling_spectroscopy', 'conductance', 'braiding', 'interference']
        },
        bias_voltage_range: {
          type: 'object',
          description: '偏压范围(mV)',
          properties: {
            min: {
              type: 'number'
            },
            max: {
              type: 'number'
            },
            step: {
              type: 'number'
            }
          }
        },
        signature_criteria: {
          type: 'object',
          description: '特征判据',
          properties: {
            zero_bias_peak: {
              type: 'boolean'
            },
            quantized_conductance: {
              type: 'boolean'
            },
            non_abelian_statistics: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['system_type', 'measurement_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        differential_conductance: {
          type: 'array'
        },
        zero_bias_peak_height: {
          type: 'number'
        },
        majorana_probability: {
          type: 'number'
        },
        topological_gap: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '马约拉纳费米子探测器使用示例',
        params: {
          system_type: 'nanowire',
          experimental_setup: 'example_value',
          measurement_type: 'tunneling_spectroscopy',
          bias_voltage_range: 'example_value',
          signature_criteria: 'example_value'
        }
      }
    ],
    required_permissions: ['science:physics'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_ice_core_analyzer',
    name: 'ice_core_analyzer',
    display_name: '冰芯分析器',
    description: '冰芯物理化学分析',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        core_info: {
          type: 'object',
          description: '冰芯信息',
          properties: {
            location: {
              type: 'string',
              enum: ['Antarctica', 'Greenland', 'Tibet', 'Alps']
            },
            depth_m: {
              type: 'number'
            },
            age_ka: {
              type: 'number',
              description: '年龄(千年)'
            }
          }
        },
        analysis_types: {
          type: 'array',
          description: '分析类型',
          items: {
            type: 'string',
            enum: ['isotope', 'greenhouse_gas', 'chemistry', 'dust', 'microstructure']
          }
        },
        isotope_ratios: {
          type: 'object',
          description: '同位素比值',
          properties: {
            delta_O18: {
              type: 'boolean'
            },
            delta_D: {
              type: 'boolean'
            },
            deuterium_excess: {
              type: 'boolean'
            }
          }
        },
        gas_measurements: {
          type: 'object',
          description: '气体测量',
          properties: {
            CO2: {
              type: 'boolean'
            },
            CH4: {
              type: 'boolean'
            },
            N2O: {
              type: 'boolean'
            }
          }
        },
        resolution: {
          type: 'number',
          description: '分辨率(cm)'
        },
        dating_method: {
          type: 'string',
          description: '定年方法',
          enum: ['layer_counting', 'volcanic_markers', 'orbital_tuning']
        }
      },
      required: ['core_info', 'analysis_types']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        isotope_profile: {
          type: 'array'
        },
        gas_concentrations: {
          type: 'object'
        },
        temperature_reconstruction: {
          type: 'array'
        },
        age_depth_model: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '冰芯分析器使用示例',
        params: {
          core_info: 'example_value',
          analysis_types: ['item1', 'item2'],
          isotope_ratios: 'example_value',
          gas_measurements: 'example_value',
          resolution: 10,
          dating_method: 'layer_counting'
        }
      }
    ],
    required_permissions: ['science:environment'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_climate_reconstructor',
    name: 'climate_reconstructor',
    display_name: '气候重建器',
    description: '古气候重建和模拟',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        proxy_data: {
          type: 'object',
          description: '代用指标数据',
          properties: {
            ice_cores: {
              type: 'array'
            },
            tree_rings: {
              type: 'array'
            },
            sediments: {
              type: 'array'
            },
            corals: {
              type: 'array'
            }
          }
        },
        reconstruction_method: {
          type: 'string',
          description: '重建方法',
          enum: ['transfer_function', 'analog', 'bayesian', 'data_assimilation']
        },
        target_variable: {
          type: 'string',
          description: '目标变量',
          enum: ['temperature', 'precipitation', 'sea_level', 'ice_volume']
        },
        time_period: {
          type: 'object',
          description: '时间段',
          properties: {
            start_ka: {
              type: 'number'
            },
            end_ka: {
              type: 'number'
            }
          }
        },
        spatial_resolution: {
          type: 'string',
          description: '空间分辨率',
          enum: ['global', 'hemispheric', 'regional', 'local']
        },
        climate_model: {
          type: 'string',
          description: '气候模型',
          enum: ['CESM', 'HadCM3', 'IPSL', 'MPI-ESM']
        }
      },
      required: ['proxy_data', 'reconstruction_method', 'target_variable']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        reconstruction: {
          type: 'array',
          description: '重建序列'
        },
        uncertainty: {
          type: 'object'
        },
        forcing_factors: {
          type: 'object'
        },
        climate_sensitivity: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '气候重建器使用示例',
        params: {
          proxy_data: {
            key: 'value',
            enabled: true
          },
          reconstruction_method: 'transfer_function',
          target_variable: 'temperature',
          time_period: 'example_value',
          spatial_resolution: 'global',
          climate_model: 'CESM'
        }
      }
    ],
    required_permissions: ['science:environment'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_magma_simulator',
    name: 'magma_simulator',
    display_name: '岩浆模拟器',
    description: '岩浆动力学模拟',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        volcano_type: {
          type: 'string',
          description: '火山类型',
          enum: ['shield', 'stratovolcano', 'caldera', 'cinder_cone']
        },
        magma_properties: {
          type: 'object',
          description: '岩浆性质',
          properties: {
            composition: {
              type: 'string',
              enum: ['basaltic', 'andesitic', 'rhyolitic']
            },
            temperature_c: {
              type: 'number'
            },
            viscosity: {
              type: 'number'
            },
            volatile_content: {
              type: 'object',
              properties: {
                H2O_wt: {
                  type: 'number'
                },
                CO2_ppm: {
                  type: 'number'
                },
                SO2_ppm: {
                  type: 'number'
                }
              }
            }
          }
        },
        chamber_geometry: {
          type: 'object',
          description: '岩浆房几何',
          properties: {
            depth_km: {
              type: 'number'
            },
            volume_km3: {
              type: 'number'
            },
            shape: {
              type: 'string',
              enum: ['spherical', 'ellipsoidal', 'sill']
            }
          }
        },
        conduit_model: {
          type: 'object',
          description: '管道模型',
          properties: {
            diameter_m: {
              type: 'number'
            },
            length_m: {
              type: 'number'
            }
          }
        },
        simulation_type: {
          type: 'string',
          description: '模拟类型',
          enum: ['eruption', 'degassing', 'crystallization', 'mixing']
        },
        boundary_conditions: {
          type: 'object',
          description: '边界条件',
          properties: {
            pressure_mpa: {
              type: 'number'
            },
            mass_flux: {
              type: 'number'
            }
          }
        }
      },
      required: ['volcano_type', 'magma_properties', 'simulation_type']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        eruption_dynamics: {
          type: 'object'
        },
        mass_eruption_rate: {
          type: 'number'
        },
        plume_height_km: {
          type: 'number'
        },
        gas_emissions: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '岩浆模拟器使用示例',
        params: {
          volcano_type: 'shield',
          magma_properties: 'example_value',
          chamber_geometry: 'example_value',
          conduit_model: 'example_value',
          simulation_type: 'eruption',
          boundary_conditions: 'example_value'
        }
      }
    ],
    required_permissions: ['science:geology'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_volcanic_monitor',
    name: 'volcanic_monitor',
    display_name: '火山监测器',
    description: '火山活动监测和预警',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        volcano_name: {
          type: 'string',
          description: '火山名称'
        },
        monitoring_systems: {
          type: 'object',
          description: '监测系统',
          properties: {
            seismic: {
              type: 'object',
              properties: {
                stations: {
                  type: 'number'
                },
                event_threshold: {
                  type: 'number'
                }
              }
            },
            deformation: {
              type: 'object',
              properties: {
                method: {
                  type: 'string',
                  enum: ['GPS', 'InSAR', 'tiltmeter']
                },
                baseline_mm: {
                  type: 'number'
                }
              }
            },
            gas: {
              type: 'object',
              properties: {
                species: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['SO2', 'CO2', 'H2S']
                  }
                },
                doas_stations: {
                  type: 'number'
                }
              }
            },
            thermal: {
              type: 'boolean',
              description: '热红外监测'
            }
          }
        },
        alert_criteria: {
          type: 'object',
          description: '预警判据',
          properties: {
            earthquake_rate: {
              type: 'number'
            },
            uplift_threshold_cm: {
              type: 'number'
            },
            so2_flux_threshold: {
              type: 'number'
            }
          }
        },
        data_window: {
          type: 'object',
          description: '数据窗口',
          properties: {
            start_time: {
              type: 'string'
            },
            end_time: {
              type: 'string'
            }
          }
        }
      },
      required: ['volcano_name', 'monitoring_systems']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        alert_level: {
          type: 'string',
          enum: ['green', 'yellow', 'orange', 'red']
        },
        seismic_activity: {
          type: 'object'
        },
        deformation_rate: {
          type: 'number'
        },
        gas_flux: {
          type: 'object'
        },
        eruption_probability: {
          type: 'number'
        },
        recommendations: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '火山监测器使用示例',
        params: {
          volcano_name: 'example_value',
          monitoring_systems: 'example_value',
          alert_criteria: 'example_value',
          data_window: {
            key: 'value',
            enabled: true
          }
        }
      }
    ],
    required_permissions: ['science:geology'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_radiocarbon_dater',
    name: 'radiocarbon_dater',
    display_name: '放射性碳测年器',
    description: '碳14年代测定',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sample_info: {
          type: 'object',
          description: '样品信息',
          properties: {
            material_type: {
              type: 'string',
              enum: ['wood', 'charcoal', 'bone', 'shell', 'sediment']
            },
            mass_mg: {
              type: 'number'
            },
            pretreatment: {
              type: 'string',
              enum: ['acid_alkali_acid', 'ultrafiltration', 'none']
            }
          }
        },
        measurement_method: {
          type: 'string',
          description: '测量方法',
          enum: ['AMS', 'LSC', 'gas_counting']
        },
        c14_measurement: {
          type: 'object',
          description: 'C14测量结果',
          properties: {
            fraction_modern: {
              type: 'number'
            },
            uncertainty: {
              type: 'number'
            },
            delta_c13: {
              type: 'number',
              description: 'δ13C同位素分馏校正'
            }
          }
        },
        calibration_curve: {
          type: 'string',
          description: '校正曲线',
          enum: ['IntCal20', 'SHCal20', 'Marine20']
        },
        reservoir_effect: {
          type: 'object',
          description: '库效应',
          properties: {
            delta_r: {
              type: 'number'
            },
            uncertainty: {
              type: 'number'
            }
          }
        }
      },
      required: ['sample_info', 'measurement_method', 'c14_measurement']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        radiocarbon_age_bp: {
          type: 'number',
          description: 'C14年龄(BP)'
        },
        calibrated_age: {
          type: 'object',
          properties: {
            median_cal_bp: {
              type: 'number'
            },
            range_68_2: {
              type: 'array',
              description: '68.2%置信区间'
            },
            range_95_4: {
              type: 'array',
              description: '95.4%置信区间'
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '放射性碳测年器使用示例',
        params: {
          sample_info: 'example_value',
          measurement_method: 'AMS',
          c14_measurement: 'example_value',
          calibration_curve: 'IntCal20',
          reservoir_effect: 'example_value'
        }
      }
    ],
    required_permissions: ['science:archaeology'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_artifact_reconstructor',
    name: 'artifact_reconstructor',
    display_name: '文物3D重建器',
    description: '文物三维重建和虚拟修复',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        artifact_type: {
          type: 'string',
          description: '文物类型',
          enum: ['pottery', 'statue', 'building', 'inscription', 'painting']
        },
        scanning_method: {
          type: 'string',
          description: '扫描方法',
          enum: ['photogrammetry', 'laser_scan', 'ct_scan', 'structured_light']
        },
        input_data: {
          type: 'object',
          description: '输入数据',
          properties: {
            images: {
              type: 'array',
              description: '图像列表'
            },
            point_cloud: {
              type: 'object',
              description: '点云数据'
            }
          }
        },
        reconstruction_settings: {
          type: 'object',
          description: '重建设置',
          properties: {
            resolution_mm: {
              type: 'number'
            },
            texture_quality: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'ultra']
            },
            mesh_optimization: {
              type: 'boolean'
            }
          }
        },
        virtual_restoration: {
          type: 'object',
          description: '虚拟修复',
          properties: {
            fill_gaps: {
              type: 'boolean'
            },
            symmetry_completion: {
              type: 'boolean'
            },
            reference_models: {
              type: 'array'
            }
          }
        },
        export_format: {
          type: 'string',
          description: '导出格式',
          enum: ['OBJ', 'STL', 'PLY', 'FBX', 'GLTF']
        }
      },
      required: ['artifact_type', 'scanning_method', 'input_data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        model_id: {
          type: 'string'
        },
        mesh_vertices: {
          type: 'number'
        },
        texture_resolution: {
          type: 'string'
        },
        completeness: {
          type: 'number',
          description: '完整度百分比'
        },
        download_url: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '文物3D重建器使用示例',
        params: {
          artifact_type: 'pottery',
          scanning_method: 'photogrammetry',
          input_data: {
            key: 'value',
            enabled: true
          },
          reconstruction_settings: 'example_value',
          virtual_restoration: 'example_value',
          export_format: 'OBJ'
        }
      }
    ],
    required_permissions: ['science:archaeology'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_flexible_sensor_designer',
    name: 'flexible_sensor_designer',
    display_name: '柔性传感器设计器',
    description: '柔性可穿戴传感器设计',
    category: 'hardware',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sensor_type: {
          type: 'string',
          description: '传感器类型',
          enum: ['strain', 'pressure', 'temperature', 'chemical', 'biopotential']
        },
        substrate: {
          type: 'object',
          description: '柔性基底',
          properties: {
            material: {
              type: 'string',
              enum: ['PET', 'PI', 'PDMS', 'paper', 'textile']
            },
            thickness_um: {
              type: 'number'
            },
            flexibility: {
              type: 'string',
              enum: ['flexible', 'stretchable', 'ultra_conformable']
            }
          }
        },
        active_material: {
          type: 'object',
          description: '活性材料',
          properties: {
            type: {
              type: 'string',
              enum: ['graphene', 'CNT', 'AgNW', 'conducting_polymer', 'MXene']
            },
            deposition_method: {
              type: 'string',
              enum: ['inkjet', 'screen_print', 'spray', 'transfer']
            }
          }
        },
        design_parameters: {
          type: 'object',
          description: '设计参数',
          properties: {
            sensing_area_mm2: {
              type: 'number'
            },
            electrode_pattern: {
              type: 'string',
              enum: ['interdigitated', 'serpentine', 'mesh']
            },
            target_sensitivity: {
              type: 'number'
            }
          }
        },
        application: {
          type: 'string',
          description: '应用场景',
          enum: ['health_monitoring', 'motion_capture', 'human_machine_interface', 'smart_textiles']
        },
        performance_requirements: {
          type: 'object',
          description: '性能要求',
          properties: {
            response_time_ms: {
              type: 'number'
            },
            power_budget_uw: {
              type: 'number'
            },
            wireless_capability: {
              type: 'boolean'
            }
          }
        }
      },
      required: ['sensor_type', 'substrate', 'active_material']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        design_id: {
          type: 'string'
        },
        predicted_performance: {
          type: 'object'
        },
        fabrication_steps: {
          type: 'array'
        },
        estimated_cost: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '柔性传感器设计器使用示例',
        params: {
          sensor_type: 'strain',
          substrate: 'example_value',
          active_material: 'example_value',
          design_parameters: 'example_value',
          application: 'health_monitoring',
          performance_requirements: 'example_value'
        }
      }
    ],
    required_permissions: ['hardware:design'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_biochip_analyzer',
    name: 'biochip_analyzer',
    display_name: '生物芯片分析器',
    description: '生物芯片数据分析',
    category: 'science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        chip_type: {
          type: 'string',
          description: '芯片类型',
          enum: ['microarray', 'microfluidic', 'lab_on_chip', 'organ_on_chip']
        },
        assay_type: {
          type: 'string',
          description: '检测类型',
          enum: ['gene_expression', 'protein', 'metabolite', 'cell_culture', 'diagnostic']
        },
        raw_data: {
          type: 'object',
          description: '原始数据',
          properties: {
            signal_intensities: {
              type: 'array'
            },
            channels: {
              type: 'number'
            },
            control_spots: {
              type: 'array'
            }
          }
        },
        normalization: {
          type: 'string',
          description: '归一化方法',
          enum: ['quantile', 'loess', 'vsn', 'rma']
        },
        background_correction: {
          type: 'boolean',
          description: '背景校正'
        },
        statistical_analysis: {
          type: 'object',
          description: '统计分析',
          properties: {
            differential_expression: {
              type: 'boolean'
            },
            clustering: {
              type: 'string',
              enum: ['hierarchical', 'kmeans', 'dbscan']
            },
            pathway_analysis: {
              type: 'boolean'
            }
          }
        },
        quality_control: {
          type: 'object',
          description: '质控参数',
          properties: {
            snr_threshold: {
              type: 'number'
            },
            cv_threshold: {
              type: 'number'
            }
          }
        }
      },
      required: ['chip_type', 'assay_type', 'raw_data']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        processed_data: {
          type: 'object'
        },
        differentially_expressed: {
          type: 'array'
        },
        clusters: {
          type: 'object'
        },
        pathways: {
          type: 'array'
        },
        quality_metrics: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生物芯片分析器使用示例',
        params: {
          chip_type: 'microarray',
          assay_type: 'gene_expression',
          raw_data: {
            key: 'value',
            enabled: true
          },
          normalization: 'quantile',
          background_correction: true,
          statistical_analysis: 'example_value',
          quality_control: 'example_value'
        }
      }
    ],
    required_permissions: ['science:biology'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_file_compressor',
    name: 'file_compressor',
    display_name: '文件压缩器',
    description: '压缩文件和文件夹为ZIP/RAR/7Z格式',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: '待压缩文件列表',
          items: {
            type: 'string'
          }
        },
        output_path: {
          type: 'string',
          description: '输出压缩包路径'
        },
        format: {
          type: 'string',
          description: '压缩格式',
          enum: ['zip', 'rar', '7z', 'tar.gz']
        },
        compression_level: {
          type: 'string',
          description: '压缩级别',
          enum: [
            'store',
            'fastest',
            'fast',
            'normal',
            'maximum',
            'ultra'
          ]
        },
        password: {
          type: 'string',
          description: '压缩包密码(可选)'
        },
        split_size: {
          type: 'number',
          description: '分卷大小(MB, 可选)'
        }
      },
      required: ['files', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        archive_path: {
          type: 'string'
        },
        compressed_size: {
          type: 'number'
        },
        original_size: {
          type: 'number'
        },
        compression_ratio: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '压缩单个文件',
        params: {
          inputPath: './document.pdf',
          outputPath: './document.pdf.gz',
          format: 'gzip'
        }
      },
      {
        description: '压缩整个目录',
        params: {
          inputPath: './project',
          outputPath: './project-backup.zip',
          format: 'zip',
          level: 9
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_file_decompressor',
    name: 'file_decompressor',
    display_name: '文件解压器',
    description: '解压ZIP/RAR/7Z等格式压缩包',
    category: 'file',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        archive_path: {
          type: 'string',
          description: '压缩包路径'
        },
        output_dir: {
          type: 'string',
          description: '解压目标目录'
        },
        password: {
          type: 'string',
          description: '密码(如果加密)'
        },
        overwrite: {
          type: 'boolean',
          description: '是否覆盖已存在文件'
        },
        extract_files: {
          type: 'array',
          description: '指定解压文件(可选)',
          items: {
            type: 'string'
          }
        }
      },
      required: ['archive_path', 'output_dir']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        extracted_files: {
          type: 'array'
        },
        total_files: {
          type: 'number'
        },
        total_size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '压缩单个文件',
        params: {
          inputPath: './document.pdf',
          outputPath: './document.pdf.gz',
          format: 'gzip'
        }
      },
      {
        description: '压缩整个目录',
        params: {
          inputPath: './project',
          outputPath: './project-backup.zip',
          format: 'zip',
          level: 9
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_image_editor',
    name: 'image_editor',
    display_name: '图片编辑器',
    description: '图片裁剪、缩放、旋转、翻转',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: '输入图片路径'
        },
        output_path: {
          type: 'string',
          description: '输出图片路径'
        },
        operations: {
          type: 'array',
          description: '操作列表',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['crop', 'resize', 'rotate', 'flip']
              },
              params: {
                type: 'object'
              }
            }
          }
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['jpg', 'png', 'webp', 'bmp', 'gif']
        },
        quality: {
          type: 'number',
          description: '输出质量(1-100)'
        }
      },
      required: ['input_path', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        width: {
          type: 'number'
        },
        height: {
          type: 'number'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          input_path: './input/sample.txt',
          output_path: './output/result.txt',
          operations: ['item1', 'item2'],
          format: 'jpg',
          quality: 10
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_image_filter',
    name: 'image_filter',
    display_name: '图片滤镜器',
    description: '应用滤镜、调整亮度对比度、添加水印',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: '输入图片路径'
        },
        output_path: {
          type: 'string',
          description: '输出图片路径'
        },
        filter: {
          type: 'string',
          description: '滤镜类型',
          enum: [
            'grayscale',
            'sepia',
            'blur',
            'sharpen',
            'vintage',
            'warm',
            'cool'
          ]
        },
        brightness: {
          type: 'number',
          description: '亮度调整(-100到100)'
        },
        contrast: {
          type: 'number',
          description: '对比度调整(-100到100)'
        },
        watermark: {
          type: 'object',
          description: '水印配置',
          properties: {
            text: {
              type: 'string'
            },
            position: {
              type: 'string',
              enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
            },
            opacity: {
              type: 'number'
            }
          }
        }
      },
      required: ['input_path', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        filter_applied: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          input_path: './input/sample.txt',
          output_path: './output/result.txt',
          filter: 'grayscale',
          brightness: 10,
          contrast: 10,
          watermark: 'example_value'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_video_cutter',
    name: 'video_cutter',
    display_name: '视频剪辑器',
    description: '剪切视频片段、提取音频',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: '输入视频路径'
        },
        output_path: {
          type: 'string',
          description: '输出视频路径'
        },
        start_time: {
          type: 'string',
          description: '开始时间(HH:MM:SS)'
        },
        end_time: {
          type: 'string',
          description: '结束时间(HH:MM:SS)'
        },
        extract_audio: {
          type: 'boolean',
          description: '是否提取音频'
        },
        audio_format: {
          type: 'string',
          description: '音频格式',
          enum: ['mp3', 'wav', 'aac', 'm4a']
        }
      },
      required: ['input_path', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        duration: {
          type: 'number'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          input_path: './input/sample.txt',
          output_path: './output/result.txt',
          start_time: 'example_value',
          end_time: 'example_value',
          extract_audio: true,
          audio_format: 'mp3'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_video_merger',
    name: 'video_merger',
    display_name: '视频合并器',
    description: '合并多个视频文件',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_files: {
          type: 'array',
          description: '输入视频列表',
          items: {
            type: 'string'
          }
        },
        output_path: {
          type: 'string',
          description: '输出视频路径'
        },
        output_format: {
          type: 'string',
          description: '输出格式',
          enum: ['mp4', 'avi', 'mkv', 'mov']
        },
        codec: {
          type: 'string',
          description: '视频编码器',
          enum: ['h264', 'h265', 'vp9', 'av1']
        },
        resolution: {
          type: 'string',
          description: '输出分辨率',
          enum: ['original', '1080p', '720p', '480p']
        }
      },
      required: ['input_files', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        total_duration: {
          type: 'number'
        },
        file_size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          input_files: './input/sample.txt',
          output_path: './output/result.txt',
          output_format: 'mp4',
          codec: 'function example() { return true; }',
          resolution: 'original'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_pdf_converter',
    name: 'pdf_converter',
    display_name: 'PDF转换器',
    description: 'PDF与其他格式互转',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: '输入文件路径'
        },
        output_path: {
          type: 'string',
          description: '输出文件路径'
        },
        conversion_type: {
          type: 'string',
          description: '转换类型',
          enum: ['to_pdf', 'from_pdf']
        },
        target_format: {
          type: 'string',
          description: '目标格式',
          enum: [
            'pdf',
            'docx',
            'xlsx',
            'pptx',
            'txt',
            'html',
            'jpg',
            'png'
          ]
        },
        options: {
          type: 'object',
          description: '转换选项',
          properties: {
            preserve_layout: {
              type: 'boolean'
            },
            ocr_enabled: {
              type: 'boolean'
            },
            image_quality: {
              type: 'number'
            }
          }
        }
      },
      required: ['input_path', 'output_path', 'target_format']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        pages: {
          type: 'number'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          input_path: './input/data.json',
          output_path: './output/result.json',
          conversion_type: 'to_pdf',
          target_format: 'pdf',
          options: 'value'
        }
      },
      {
        description: '批量处理文档',
        params: {
          input_path: './advanced_input/data.json',
          output_path: './advanced_output/result.json',
          conversion_type: 'from_pdf',
          target_format: 'docx',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_office_converter',
    name: 'office_converter',
    display_name: 'Office文档转换器',
    description: 'Word/Excel/PPT格式互转',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        input_path: {
          type: 'string',
          description: '输入文件路径'
        },
        output_path: {
          type: 'string',
          description: '输出文件路径'
        },
        source_format: {
          type: 'string',
          description: '源格式',
          enum: [
            'doc',
            'docx',
            'xls',
            'xlsx',
            'ppt',
            'pptx',
            'odt',
            'ods',
            'odp'
          ]
        },
        target_format: {
          type: 'string',
          description: '目标格式',
          enum: [
            'doc',
            'docx',
            'xls',
            'xlsx',
            'ppt',
            'pptx',
            'pdf',
            'html',
            'txt'
          ]
        },
        preserve_formatting: {
          type: 'boolean',
          description: '保留格式'
        }
      },
      required: ['input_path', 'output_path', 'target_format']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        output_path: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          input_path: './input/data.json',
          output_path: './output/result.json',
          source_format: 'doc',
          target_format: 'doc',
          preserve_formatting: false
        }
      },
      {
        description: '批量处理文档',
        params: {
          input_path: './advanced_input/data.json',
          output_path: './advanced_output/result.json',
          source_format: 'docx',
          target_format: 'docx',
          preserve_formatting: true
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_qrcode_generator_advanced',
    name: 'qrcode_generator_advanced',
    display_name: '高级二维码生成器',
    description: '生成自定义样式的二维码',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '二维码内容'
        },
        output_path: {
          type: 'string',
          description: '输出图片路径'
        },
        size: {
          type: 'number',
          description: '尺寸(像素)',
          default: 256
        },
        error_correction: {
          type: 'string',
          description: '容错级别',
          enum: ['L', 'M', 'Q', 'H']
        },
        style: {
          type: 'object',
          description: '样式配置',
          properties: {
            foreground_color: {
              type: 'string'
            },
            background_color: {
              type: 'string'
            },
            logo_path: {
              type: 'string'
            },
            logo_size_ratio: {
              type: 'number'
            }
          }
        },
        format: {
          type: 'string',
          description: '输出格式',
          enum: ['png', 'jpg', 'svg']
        }
      },
      required: ['content', 'output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        qrcode_path: {
          type: 'string'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '高级二维码生成器基础用法',
        params: {
          content: '示例文本',
          output_path: './output/result.json',
          size: 10,
          error_correction: 'L',
          style: 'value',
          format: 'png'
        }
      },
      {
        description: '高级二维码生成器高级用法',
        params: {
          content: '更复杂的示例文本内容，用于测试高级功能',
          output_path: './advanced_output/result.json',
          size: 50,
          error_correction: 'M',
          style: 'advanced_value',
          format: 'jpg'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_qrcode_scanner',
    name: 'qrcode_scanner',
    display_name: '二维码扫描器',
    description: '识别图片中的二维码/条形码',
    category: 'utility',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        image_path: {
          type: 'string',
          description: '图片路径或URL'
        },
        scan_type: {
          type: 'string',
          description: '扫描类型',
          enum: ['qrcode', 'barcode', 'auto']
        },
        multiple: {
          type: 'boolean',
          description: '识别多个码'
        }
      },
      required: ['image_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        codes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string'
              },
              data: {
                type: 'string'
              },
              position: {
                type: 'object'
              }
            }
          }
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '二维码扫描器基础用法',
        params: {
          image_path: './data/sample.dat',
          scan_type: 'qrcode',
          multiple: false
        }
      },
      {
        description: '二维码扫描器高级用法',
        params: {
          image_path: './advanced_data/sample.dat',
          scan_type: 'barcode',
          multiple: true
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_screenshot_tool',
    name: 'screenshot_tool',
    display_name: '截图工具',
    description: '屏幕截图和标注',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description: '输出图片路径'
        },
        capture_type: {
          type: 'string',
          description: '截图类型',
          enum: ['fullscreen', 'window', 'region', 'active_window']
        },
        region: {
          type: 'object',
          description: '截图区域',
          properties: {
            x: {
              type: 'number'
            },
            y: {
              type: 'number'
            },
            width: {
              type: 'number'
            },
            height: {
              type: 'number'
            }
          }
        },
        include_cursor: {
          type: 'boolean',
          description: '包含鼠标指针'
        },
        format: {
          type: 'string',
          description: '图片格式',
          enum: ['png', 'jpg', 'bmp']
        }
      },
      required: ['output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        screenshot_path: {
          type: 'string'
        },
        width: {
          type: 'number'
        },
        height: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          output_path: './output/result.txt',
          capture_type: 'fullscreen',
          region: 'example_value',
          include_cursor: true,
          format: 'png'
        }
      }
    ],
    required_permissions: ['system:screen'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_screen_recorder',
    name: 'screen_recorder',
    display_name: '屏幕录制器',
    description: '录制屏幕视频或GIF',
    category: 'media',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description: '输出文件路径'
        },
        output_format: {
          type: 'string',
          description: '输出格式',
          enum: ['mp4', 'avi', 'gif', 'webm']
        },
        capture_type: {
          type: 'string',
          description: '录制类型',
          enum: ['fullscreen', 'window', 'region']
        },
        region: {
          type: 'object',
          description: '录制区域'
        },
        fps: {
          type: 'number',
          description: '帧率(FPS)'
        },
        record_audio: {
          type: 'boolean',
          description: '是否录制音频'
        },
        duration: {
          type: 'number',
          description: '录制时长(秒)'
        }
      },
      required: ['output_path']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        video_path: {
          type: 'string'
        },
        duration: {
          type: 'number'
        },
        size: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理媒体文件',
        params: {
          output_path: './output/result.txt',
          output_format: 'mp4',
          capture_type: 'fullscreen',
          region: 'example_value',
          fps: 10,
          record_audio: true,
          duration: 10
        }
      }
    ],
    required_permissions: ['system:screen', 'system:audio'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_calendar_manager',
    name: 'calendar_manager',
    display_name: '日历管理器',
    description: '创建和管理日历事件',
    category: 'productivity',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['create', 'update', 'delete', 'query']
        },
        event: {
          type: 'object',
          description: '事件信息',
          properties: {
            id: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            description: {
              type: 'string'
            },
            start_time: {
              type: 'string'
            },
            end_time: {
              type: 'string'
            },
            location: {
              type: 'string'
            },
            attendees: {
              type: 'array'
            },
            recurrence: {
              type: 'object'
            }
          }
        },
        date_range: {
          type: 'object',
          description: '查询日期范围',
          properties: {
            start: {
              type: 'string'
            },
            end: {
              type: 'string'
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        event: {
          type: 'object'
        },
        events: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '日历管理器使用示例',
        params: {
          action: 'create',
          event: 'example_value',
          date_range: 'example_value'
        }
      }
    ],
    required_permissions: ['calendar:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_reminder_scheduler',
    name: 'reminder_scheduler',
    display_name: '提醒调度器',
    description: '设置和管理提醒事项',
    category: 'productivity',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作',
          enum: ['create', 'update', 'delete', 'list']
        },
        reminder: {
          type: 'object',
          description: '提醒信息',
          properties: {
            id: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            description: {
              type: 'string'
            },
            remind_time: {
              type: 'string'
            },
            repeat: {
              type: 'string',
              enum: ['none', 'daily', 'weekly', 'monthly']
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high']
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        reminder: {
          type: 'object'
        },
        reminders: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '提醒调度器使用示例',
        params: {
          action: 'create',
          reminder: 'example_value'
        }
      }
    ],
    required_permissions: ['notification:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_note_editor',
    name: 'note_editor',
    display_name: '笔记编辑器',
    description: 'Markdown笔记编辑和管理',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作',
          enum: ['create', 'read', 'update', 'delete']
        },
        note: {
          type: 'object',
          description: '笔记信息',
          properties: {
            id: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            content: {
              type: 'string'
            },
            tags: {
              type: 'array'
            },
            folder: {
              type: 'string'
            },
            format: {
              type: 'string',
              enum: ['markdown', 'rich_text', 'plain']
            }
          }
        }
      },
      required: ['action']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        note: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          action: 'create',
          note: 'value'
        }
      },
      {
        description: '批量处理文档',
        params: {
          action: 'read',
          note: 'advanced_value'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_note_searcher',
    name: 'note_searcher',
    display_name: '笔记搜索器',
    description: '搜索和筛选笔记',
    category: 'document',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词'
        },
        filters: {
          type: 'object',
          description: '筛选条件',
          properties: {
            tags: {
              type: 'array'
            },
            folder: {
              type: 'string'
            },
            date_from: {
              type: 'string'
            },
            date_to: {
              type: 'string'
            },
            format: {
              type: 'string'
            }
          }
        },
        sort_by: {
          type: 'string',
          description: '排序方式',
          enum: ['created_at', 'updated_at', 'title', 'relevance']
        },
        limit: {
          type: 'number',
          description: '返回数量限制'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        notes: {
          type: 'array'
        },
        total: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理单个文档',
        params: {
          query: '搜索关键词',
          filters: 'value',
          sort_by: 'created_at',
          limit: 10
        }
      },
      {
        description: '批量处理文档',
        params: {
          query: '复杂查询：条件A AND 条件B',
          filters: 'advanced_value',
          sort_by: 'updated_at',
          limit: 100
        }
      }
    ],
    required_permissions: ['file:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_password_generator_advanced',
    name: 'password_generator_advanced',
    display_name: '高级密码生成器',
    description: '生成强密码并评估强度',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        length: {
          type: 'number',
          description: '密码长度',
          default: 16
        },
        include_uppercase: {
          type: 'boolean',
          description: '包含大写字母'
        },
        include_lowercase: {
          type: 'boolean',
          description: '包含小写字母'
        },
        include_numbers: {
          type: 'boolean',
          description: '包含数字'
        },
        include_symbols: {
          type: 'boolean',
          description: '包含特殊字符'
        },
        exclude_ambiguous: {
          type: 'boolean',
          description: '排除易混淆字符(0,O,l,1等)'
        },
        custom_charset: {
          type: 'string',
          description: '自定义字符集'
        },
        count: {
          type: 'number',
          description: '生成数量',
          default: 1
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        passwords: {
          type: 'array'
        },
        strength: {
          type: 'string'
        },
        entropy: {
          type: 'number'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '高级密码生成器使用示例',
        params: {
          length: 16,
          include_uppercase: true,
          include_lowercase: true,
          include_numbers: true,
          include_symbols: true,
          exclude_ambiguous: true,
          custom_charset: 'example_value',
          count: 1
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_password_vault',
    name: 'password_vault',
    display_name: '密码保险库',
    description: '加密存储和管理密码',
    category: 'security',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: '操作',
          enum: ['add', 'get', 'update', 'delete', 'list']
        },
        entry: {
          type: 'object',
          description: '密码条目',
          properties: {
            id: {
              type: 'string'
            },
            title: {
              type: 'string'
            },
            username: {
              type: 'string'
            },
            password: {
              type: 'string'
            },
            url: {
              type: 'string'
            },
            notes: {
              type: 'string'
            },
            tags: {
              type: 'array'
            }
          }
        },
        master_password: {
          type: 'string',
          description: '主密码'
        },
        search_query: {
          type: 'string',
          description: '搜索关键词'
        }
      },
      required: ['action', 'master_password']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        entry: {
          type: 'object'
        },
        entries: {
          type: 'array'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '密码保险库使用示例',
        params: {
          action: 'add',
          entry: 'example_value',
          master_password: 'example_value',
          search_query: 'example_value'
        }
      }
    ],
    required_permissions: ['security:password'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_network_speed_tester',
    name: 'network_speed_tester',
    display_name: '网速测试器',
    description: '测试网络上传和下载速度',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        test_type: {
          type: 'string',
          description: '测试类型',
          enum: ['download', 'upload', 'both', 'ping_only']
        },
        server: {
          type: 'string',
          description: '测速服务器(可选)'
        },
        duration: {
          type: 'number',
          description: '测试时长(秒)'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        download_speed: {
          type: 'number',
          description: 'Mbps'
        },
        upload_speed: {
          type: 'number',
          description: 'Mbps'
        },
        ping: {
          type: 'number',
          description: 'ms'
        },
        jitter: {
          type: 'number',
          description: 'ms'
        },
        server_location: {
          type: 'string'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络网速测试器',
        params: {
          test_type: 'download',
          server: 'value',
          duration: 10
        }
      },
      {
        description: '高级网络网速测试器',
        params: {
          test_type: 'upload',
          server: 'advanced_value',
          duration: 50
        }
      }
    ],
    required_permissions: ['network:test'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_network_diagnostic_tool',
    name: 'network_diagnostic_tool',
    display_name: '网络诊断工具',
    description: 'Ping、端口扫描、DNS查询、路由追踪',
    category: 'network',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: '诊断操作',
          enum: ['ping', 'port_scan', 'dns_lookup', 'traceroute', 'whois']
        },
        target: {
          type: 'string',
          description: '目标主机或域名'
        },
        options: {
          type: 'object',
          description: '操作选项',
          properties: {
            count: {
              type: 'number',
              description: 'Ping次数'
            },
            timeout: {
              type: 'number',
              description: '超时(ms)'
            },
            ports: {
              type: 'array',
              description: '端口列表'
            },
            port_range: {
              type: 'object',
              properties: {
                start: {
                  type: 'number'
                },
                end: {
                  type: 'number'
                }
              }
            },
            dns_server: {
              type: 'string'
            },
            max_hops: {
              type: 'number'
            }
          }
        }
      },
      required: ['operation', 'target']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        result: {
          type: 'object'
        },
        error: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '基本网络网络诊断工具',
        params: {
          operation: 'ping',
          target: 'value',
          options: 'value'
        }
      },
      {
        description: '高级网络网络诊断工具',
        params: {
          operation: 'port_scan',
          target: 'advanced_value',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:diagnostic'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_data_preprocessor',
    name: 'data_preprocessor',
    display_name: '数据预处理器',
    description: '数据清洗、缺失值处理、异常值检测、特征缩放和编码',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径（CSV/Excel）'
        },
        operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'remove_duplicates',
              'handle_missing',
              'detect_outliers',
              'normalize',
              'standardize',
              'encode_categorical',
              'one_hot_encode',
              'label_encode'
            ]
          },
          description: '预处理操作列表'
        },
        options: {
          type: 'object',
          properties: {
            missingStrategy: {
              type: 'string',
              enum: [
                'drop',
                'mean',
                'median',
                'mode',
                'forward_fill',
                'backward_fill'
              ],
              default: 'median'
            },
            outlierMethod: {
              type: 'string',
              enum: ['iqr', 'zscore', 'isolation_forest'],
              default: 'iqr'
            },
            scalingMethod: {
              type: 'string',
              enum: ['standard', 'minmax', 'robust'],
              default: 'standard'
            }
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        }
      },
      required: ['dataPath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        rowsProcessed: {
          type: 'number'
        },
        columnsProcessed: {
          type: 'number'
        },
        summary: {
          type: 'object',
          properties: {
            duplicatesRemoved: {
              type: 'number'
            },
            missingValuesHandled: {
              type: 'number'
            },
            outliersDetected: {
              type: 'number'
            }
          }
        }
      }
    },
    examples: [
      {
        description: '清洗并标准化数据',
        params: {
          dataPath: './data/raw/customer_data.csv',
          operations: ['remove_duplicates', 'handle_missing', 'standardize'],
          options: {
            missingStrategy: 'median',
            scalingMethod: 'standard'
          },
          outputPath: './data/processed/customer_data_clean.csv'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_feature_engineer',
    name: 'feature_engineer',
    display_name: '特征工程工具',
    description: '特征创建、选择、转换和降维',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        operations: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'polynomial_features',
              'interaction_features',
              'binning',
              'pca',
              'feature_selection',
              'timestamp_features'
            ]
          }
        },
        config: {
          type: 'object',
          properties: {
            polynomialDegree: {
              type: 'number',
              default: 2
            },
            pcaComponents: {
              type: 'number',
              default: 0.95
            },
            selectionMethod: {
              type: 'string',
              enum: ['chi2', 'mutual_info', 'f_classif', 'rfe'],
              default: 'mutual_info'
            },
            topK: {
              type: 'number',
              description: '保留前K个特征'
            }
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        }
      },
      required: ['dataPath', 'operations']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        outputPath: {
          type: 'string'
        },
        originalFeatures: {
          type: 'number'
        },
        newFeatures: {
          type: 'number'
        },
        featureNames: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      }
    },
    examples: [
      {
        description: '创建多项式特征并进行特征选择',
        params: {
          dataPath: './data/processed/features.csv',
          operations: ['polynomial_features', 'feature_selection'],
          config: {
            polynomialDegree: 2,
            selectionMethod: 'mutual_info',
            topK: 20
          },
          outputPath: './data/processed/features_engineered.csv'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_model_evaluator',
    name: 'model_evaluator',
    display_name: '模型评估器',
    description: '评估模型性能，生成评估报告和可视化',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        modelPath: {
          type: 'string',
          description: '模型文件路径'
        },
        testDataPath: {
          type: 'string',
          description: '测试数据路径'
        },
        taskType: {
          type: 'string',
          enum: ['classification', 'regression', 'clustering'],
          description: '任务类型'
        },
        generatePlots: {
          type: 'boolean',
          default: true,
          description: '是否生成可视化图表'
        },
        reportOutputPath: {
          type: 'string',
          description: '评估报告输出路径'
        }
      },
      required: ['modelPath', 'testDataPath', 'taskType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        metrics: {
          type: 'object',
          description: '评估指标（accuracy、f1_score、rmse等）'
        },
        confusionMatrix: {
          type: 'array'
        },
        featureImportance: {
          type: 'array'
        },
        plots: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '生成的图表路径列表'
        },
        reportPath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '评估分类模型',
        params: {
          modelPath: './models/rf_model.pkl',
          testDataPath: './data/test.csv',
          taskType: 'classification',
          generatePlots: true,
          reportOutputPath: './reports/model_evaluation.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_statistical_analyzer',
    name: 'statistical_analyzer',
    display_name: '统计分析工具',
    description: '执行描述性统计、相关性分析、假设检验等',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        analyses: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'descriptive',
              'correlation',
              't_test',
              'chi_square',
              'anova',
              'normality_test',
              'distribution_fit'
            ]
          },
          description: '分析类型列表'
        },
        columns: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '要分析的列名（可选）'
        },
        options: {
          type: 'object',
          properties: {
            confidence_level: {
              type: 'number',
              default: 0.95
            },
            method: {
              type: 'string'
            }
          }
        },
        reportOutputPath: {
          type: 'string',
          description: '分析报告输出路径'
        }
      },
      required: ['dataPath', 'analyses']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        results: {
          type: 'object',
          description: '分析结果'
        },
        reportPath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '执行描述性统计和相关性分析',
        params: {
          dataPath: './data/sales_data.csv',
          analyses: ['descriptive', 'correlation'],
          reportOutputPath: './reports/statistical_analysis.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_eda_generator',
    name: 'eda_generator',
    display_name: 'EDA报告生成器',
    description: '自动生成探索性数据分析报告，包含数据概览、分布、相关性等',
    category: 'data-science',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        dataPath: {
          type: 'string',
          description: '数据文件路径'
        },
        targetColumn: {
          type: 'string',
          description: '目标变量（可选）'
        },
        reportType: {
          type: 'string',
          enum: ['quick', 'detailed', 'comprehensive'],
          default: 'detailed',
          description: '报告详细程度'
        },
        outputFormat: {
          type: 'string',
          enum: ['html', 'pdf', 'notebook'],
          default: 'html',
          description: '输出格式'
        },
        outputPath: {
          type: 'string',
          description: '输出路径'
        }
      },
      required: ['dataPath', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        reportPath: {
          type: 'string'
        },
        sections: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '报告章节列表'
        }
      }
    },
    examples: [
      {
        description: '生成详细EDA报告',
        params: {
          dataPath: './data/customer_data.csv',
          targetColumn: 'churn',
          reportType: 'detailed',
          outputFormat: 'html',
          outputPath: './reports/eda_report.html'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_word_generator',
    name: 'word_generator',
    display_name: 'Word文档生成器',
    description: '生成Word文档（.docx格式），支持标题、段落、表格、图片',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '文档标题'
        },
        content: {
          type: 'string',
          description: '文档内容（支持Markdown格式）'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        template: {
          type: 'string',
          description: '模板路径（可选）'
        },
        options: {
          type: 'object',
          description: '文档选项',
          properties: {
            fontSize: {
              type: 'number',
              default: 12
            },
            fontFamily: {
              type: 'string',
              default: '宋体'
            },
            lineSpacing: {
              type: 'number',
              default: 1.5
            },
            pageSize: {
              type: 'string',
              enum: ['A4', 'A5', 'Letter'],
              default: 'A4'
            },
            margin: {
              type: 'object',
              properties: {
                top: {
                  type: 'number',
                  default: 2.54
                },
                bottom: {
                  type: 'number',
                  default: 2.54
                },
                left: {
                  type: 'number',
                  default: 3.18
                },
                right: {
                  type: 'number',
                  default: 3.18
                }
              }
            }
          }
        }
      },
      required: ['title', 'content', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        fileSize: {
          type: 'number'
        },
        pageCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '生成商业计划书',
        params: {
          title: '2025年商业计划书',
          content: `# 执行摘要

项目描述...`,
          outputPath: './business-plan.docx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_word_table_creator',
    name: 'word_table_creator',
    display_name: 'Word表格创建器',
    description: '在Word文档中创建和格式化表格',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        documentPath: {
          type: 'string',
          description: 'Word文档路径'
        },
        tableData: {
          type: 'object',
          description: '表格数据',
          properties: {
            headers: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            rows: {
              type: 'array',
              items: {
                type: 'array'
              }
            }
          },
          required: ['headers', 'rows']
        },
        style: {
          type: 'string',
          enum: ['simple', 'grid', 'striped', 'modern'],
          default: 'grid',
          description: '表格样式'
        }
      },
      required: ['documentPath', 'tableData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        tableCount: {
          type: 'number'
        },
        rowCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '创建预算表',
        params: {
          documentPath: './report.docx',
          tableData: {
            headers: ['项目', '预算', '实际', '差异'],
            rows: [
              ['人力成本', '100万', '95万', '-5万'],
              ['营销费用', '50万', '60万', '+10万']
            ]
          },
          style: 'modern'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_excel_generator',
    name: 'excel_generator',
    display_name: 'Excel电子表格生成器',
    description: '生成Excel文件（.xlsx格式），支持多工作表、公式、图表',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        sheets: {
          type: 'array',
          description: '工作表数组',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '工作表名称'
              },
              data: {
                type: 'array',
                description: '二维数组数据',
                items: {
                  type: 'array'
                }
              },
              headers: {
                type: 'array',
                description: '表头（可选）',
                items: {
                  type: 'string'
                }
              },
              columnWidths: {
                type: 'array',
                description: '列宽数组',
                items: {
                  type: 'number'
                }
              }
            },
            required: ['name', 'data']
          }
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          description: 'Excel选项',
          properties: {
            creator: {
              type: 'string',
              default: 'ChainlessChain'
            },
            created: {
              type: 'string'
            },
            autoFilter: {
              type: 'boolean',
              default: false
            },
            freeze: {
              type: 'object',
              properties: {
                row: {
                  type: 'number'
                },
                column: {
                  type: 'number'
                }
              }
            }
          }
        }
      },
      required: ['sheets', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        sheetCount: {
          type: 'number'
        },
        totalRows: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '生成财务报表',
        params: {
          sheets: [
            {
              name: '收入明细',
              headers: ['月份', '产品销售', '服务收入', '合计'],
              data: [
                ['1月', 100000, 50000, '=B2+C2'],
                ['2月', 120000, 55000, '=B3+C3']
              ]
            }
          ],
          outputPath: './financial-report.xlsx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_excel_formula_builder',
    name: 'excel_formula_builder',
    display_name: 'Excel公式构建器',
    description: '生成和验证Excel公式',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        formulaType: {
          type: 'string',
          enum: [
            'SUM',
            'AVERAGE',
            'IF',
            'VLOOKUP',
            'COUNTIF',
            'SUMIF',
            'CONCATENATE',
            'CUSTOM'
          ],
          description: '公式类型'
        },
        range: {
          type: 'string',
          description: '单元格范围（例如：A1:A10）'
        },
        condition: {
          type: 'string',
          description: '条件（用于IF、COUNTIF等）'
        },
        customFormula: {
          type: 'string',
          description: '自定义公式（当formulaType为CUSTOM时）'
        }
      },
      required: ['formulaType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        formula: {
          type: 'string'
        },
        description: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生成求和公式',
        params: {
          formulaType: 'SUM',
          range: 'B2:B100'
        }
      },
      {
        description: '生成条件计数公式',
        params: {
          formulaType: 'COUNTIF',
          range: 'A2:A100',
          condition: '>100'
        }
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_excel_chart_creator',
    name: 'excel_chart_creator',
    display_name: 'Excel图表创建器',
    description: '在Excel工作表中创建图表',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        workbookPath: {
          type: 'string',
          description: 'Excel文件路径'
        },
        sheetName: {
          type: 'string',
          description: '工作表名称'
        },
        chartType: {
          type: 'string',
          enum: [
            'line',
            'bar',
            'column',
            'pie',
            'area',
            'scatter',
            'doughnut'
          ],
          description: '图表类型'
        },
        dataRange: {
          type: 'string',
          description: '数据范围（例如：A1:D10）'
        },
        title: {
          type: 'string',
          description: '图表标题'
        },
        position: {
          type: 'object',
          description: '图表位置',
          properties: {
            row: {
              type: 'number'
            },
            column: {
              type: 'number'
            }
          }
        }
      },
      required: ['workbookPath', 'sheetName', 'chartType', 'dataRange']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        chartId: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '创建柱状图',
        params: {
          workbookPath: './sales-data.xlsx',
          sheetName: '月度销售',
          chartType: 'column',
          dataRange: 'A1:B12',
          title: '2025年月度销售趋势'
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_ppt_generator',
    name: 'ppt_generator',
    display_name: 'PPT演示文稿生成器',
    description: '生成PowerPoint文件（.pptx格式）',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        slides: {
          type: 'array',
          description: '幻灯片数组',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '幻灯片标题'
              },
              content: {
                type: 'string',
                description: '幻灯片内容'
              },
              layout: {
                type: 'string',
                enum: [
                  'title',
                  'titleAndContent',
                  'sectionHeader',
                  'twoContent',
                  'comparison',
                  'titleOnly',
                  'blank'
                ],
                description: '布局类型'
              },
              notes: {
                type: 'string',
                description: '演讲者备注'
              }
            },
            required: ['title', 'layout']
          }
        },
        theme: {
          type: 'string',
          enum: ['default', 'modern', 'professional', 'creative', 'minimal'],
          default: 'default',
          description: '主题名称'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径'
        },
        options: {
          type: 'object',
          properties: {
            author: {
              type: 'string'
            },
            company: {
              type: 'string'
            },
            slideSize: {
              type: 'string',
              enum: ['standard', 'widescreen', 'custom'],
              default: 'widescreen'
            }
          }
        }
      },
      required: ['slides', 'outputPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        slideCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '生成产品发布会PPT',
        params: {
          slides: [
            {
              title: '产品发布会',
              content: '全新AI助手发布',
              layout: 'title'
            },
            {
              title: '核心功能',
              content: `1. 智能对话
2. 文档生成
3. 数据分析`,
              layout: 'titleAndContent'
            }
          ],
          theme: 'modern',
          outputPath: './product-launch.pptx'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_ppt_slide_creator',
    name: 'ppt_slide_creator',
    display_name: 'PPT幻灯片创建器',
    description: '向现有PowerPoint文件添加幻灯片',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        presentationPath: {
          type: 'string',
          description: 'PPT文件路径'
        },
        slide: {
          type: 'object',
          description: '幻灯片配置',
          properties: {
            title: {
              type: 'string'
            },
            content: {
              type: 'string'
            },
            layout: {
              type: 'string'
            },
            position: {
              type: 'number',
              description: '插入位置（索引）'
            }
          },
          required: ['title', 'layout']
        }
      },
      required: ['presentationPath', 'slide']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        slideIndex: {
          type: 'number'
        },
        totalSlides: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '添加总结幻灯片',
        params: {
          presentationPath: './presentation.pptx',
          slide: {
            title: '总结',
            content: '感谢聆听！',
            layout: 'titleOnly'
          }
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_ppt_theme_applicator',
    name: 'ppt_theme_applicator',
    display_name: 'PPT主题应用器',
    description: '为PowerPoint应用或修改主题样式',
    category: 'office',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        presentationPath: {
          type: 'string',
          description: 'PPT文件路径'
        },
        theme: {
          type: 'object',
          description: '主题配置',
          properties: {
            primaryColor: {
              type: 'string',
              description: '主色调（十六进制）'
            },
            secondaryColor: {
              type: 'string',
              description: '辅助色'
            },
            fontFamily: {
              type: 'string',
              description: '字体'
            },
            backgroundStyle: {
              type: 'string',
              enum: ['solid', 'gradient', 'image'],
              description: '背景样式'
            }
          }
        }
      },
      required: ['presentationPath', 'theme']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        appliedSlides: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '应用企业主题',
        params: {
          presentationPath: './company-intro.pptx',
          theme: {
            primaryColor: '#0066CC',
            secondaryColor: '#FF6600',
            fontFamily: '微软雅黑',
            backgroundStyle: 'gradient'
          }
        }
      }
    ],
    required_permissions: ['file:read', 'file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_npm_project_setup',
    name: 'npm_project_setup',
    display_name: 'NPM项目初始化',
    description: '初始化Node.js/NPM项目，创建项目结构和配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称'
        },
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        template: {
          type: 'string',
          enum: [
            'basic',
            'express',
            'koa',
            'nest',
            'cli',
            'library'
          ],
          default: 'basic',
          description: '项目模板'
        },
        packageManager: {
          type: 'string',
          enum: ['npm', 'yarn', 'pnpm'],
          default: 'npm',
          description: '包管理器'
        },
        initGit: {
          type: 'boolean',
          default: true,
          description: '是否初始化Git仓库'
        },
        installDeps: {
          type: 'boolean',
          default: false,
          description: '是否自动安装依赖'
        }
      },
      required: ['projectName', 'projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        projectPath: {
          type: 'string'
        },
        filesCreated: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      }
    },
    examples: [
      {
        description: '初始化Express项目',
        params: {
          projectName: 'my-api-server',
          projectPath: './projects/my-api-server',
          template: 'express',
          packageManager: 'npm',
          initGit: true
        }
      }
    ],
    required_permissions: ['file:write', 'command:execute'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_package_json_builder',
    name: 'package_json_builder',
    display_name: 'package.json构建器',
    description: '生成或更新package.json文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        config: {
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            version: {
              type: 'string',
              default: '1.0.0'
            },
            description: {
              type: 'string'
            },
            main: {
              type: 'string',
              default: 'index.js'
            },
            scripts: {
              type: 'object'
            },
            dependencies: {
              type: 'object'
            },
            devDependencies: {
              type: 'object'
            },
            keywords: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            author: {
              type: 'string'
            },
            license: {
              type: 'string',
              default: 'MIT'
            }
          },
          required: ['name']
        }
      },
      required: ['projectPath', 'config']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '创建基本package.json',
        params: {
          projectPath: './my-project',
          config: {
            name: 'my-awesome-app',
            version: '1.0.0',
            description: 'An awesome Node.js application',
            scripts: {
              start: 'node index.js',
              dev: 'nodemon index.js',
              test: 'jest'
            },
            dependencies: {
              express: '^4.18.0'
            },
            devDependencies: {
              nodemon: '^3.0.0',
              jest: '^29.0.0'
            }
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_python_project_setup',
    name: 'python_project_setup',
    display_name: 'Python项目初始化',
    description: '初始化Python项目结构，支持多种项目类型',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称'
        },
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        projectType: {
          type: 'string',
          enum: [
            'package',
            'script',
            'flask',
            'django',
            'fastapi',
            'ml',
            'data-science'
          ],
          default: 'package',
          description: '项目类型'
        },
        pythonVersion: {
          type: 'string',
          default: '3.9',
          description: 'Python版本'
        },
        useVirtualEnv: {
          type: 'boolean',
          default: true,
          description: '是否创建虚拟环境'
        },
        initGit: {
          type: 'boolean',
          default: true,
          description: '是否初始化Git仓库'
        }
      },
      required: ['projectName', 'projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        projectPath: {
          type: 'string'
        },
        filesCreated: {
          type: 'array',
          items: {
            type: 'string'
          }
        },
        venvPath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '初始化Flask Web项目',
        params: {
          projectName: 'my-flask-app',
          projectPath: './projects/my-flask-app',
          projectType: 'flask',
          pythonVersion: '3.10',
          useVirtualEnv: true
        }
      },
      {
        description: '初始化机器学习项目',
        params: {
          projectName: 'ml-project',
          projectPath: './projects/ml-project',
          projectType: 'ml',
          pythonVersion: '3.9'
        }
      }
    ],
    required_permissions: ['file:write', 'command:execute'],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_requirements_generator',
    name: 'requirements_generator',
    display_name: 'requirements.txt生成器',
    description: '生成Python项目的requirements.txt文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        packages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string'
              },
              version: {
                type: 'string'
              },
              extras: {
                type: 'array',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['name']
          },
          description: '包列表'
        },
        autoDetect: {
          type: 'boolean',
          default: false,
          description: '是否自动检测当前环境的包'
        },
        outputPath: {
          type: 'string',
          description: '输出文件路径（可选）'
        }
      },
      required: ['projectPath']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        packageCount: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '生成机器学习项目依赖',
        params: {
          projectPath: './ml-project',
          packages: [
            {
              name: 'numpy',
              version: '1.26.2'
            },
            {
              name: 'pandas',
              version: '2.1.3'
            },
            {
              name: 'scikit-learn',
              version: '1.3.2'
            },
            {
              name: 'tensorflow',
              version: '2.15.0'
            }
          ]
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_setup_py_generator',
    name: 'setup_py_generator',
    display_name: 'setup.py生成器',
    description: '生成Python包的setup.py配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        config: {
          type: 'object',
          properties: {
            name: {
              type: 'string'
            },
            version: {
              type: 'string'
            },
            author: {
              type: 'string'
            },
            author_email: {
              type: 'string'
            },
            description: {
              type: 'string'
            },
            long_description: {
              type: 'string'
            },
            url: {
              type: 'string'
            },
            packages: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            install_requires: {
              type: 'array',
              items: {
                type: 'string'
              }
            },
            python_requires: {
              type: 'string',
              default: '>=3.7'
            },
            classifiers: {
              type: 'array',
              items: {
                type: 'string'
              }
            }
          },
          required: ['name', 'version']
        }
      },
      required: ['projectPath', 'config']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生成Python包配置',
        params: {
          projectPath: './my-package',
          config: {
            name: 'my-awesome-package',
            version: '0.1.0',
            author: 'Your Name',
            author_email: 'your.email@example.com',
            description: 'A short description',
            install_requires: ['requests>=2.28.0', 'numpy>=1.24.0']
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_dockerfile_generator',
    name: 'dockerfile_generator',
    display_name: 'Dockerfile生成器',
    description: '生成Docker容器配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        baseImage: {
          type: 'string',
          description: '基础镜像',
          default: 'node:18-alpine'
        },
        appType: {
          type: 'string',
          enum: ['nodejs', 'python', 'java', 'go', 'custom'],
          description: '应用类型'
        },
        workdir: {
          type: 'string',
          default: '/app',
          description: '工作目录'
        },
        port: {
          type: 'number',
          description: '暴露端口'
        },
        entrypoint: {
          type: 'string',
          description: '入口命令'
        },
        buildSteps: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '构建步骤'
        }
      },
      required: ['projectPath', 'appType']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生成Node.js应用Dockerfile',
        params: {
          projectPath: './my-app',
          baseImage: 'node:18-alpine',
          appType: 'nodejs',
          port: 3000,
          entrypoint: 'node index.js'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_docker_compose_generator',
    name: 'docker_compose_generator',
    display_name: 'docker-compose.yml生成器',
    description: '生成Docker Compose配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string'
              },
              image: {
                type: 'string'
              },
              build: {
                type: 'string'
              },
              ports: {
                type: 'array',
                items: {
                  type: 'string'
                }
              },
              volumes: {
                type: 'array',
                items: {
                  type: 'string'
                }
              },
              environment: {
                type: 'object'
              },
              depends_on: {
                type: 'array',
                items: {
                  type: 'string'
                }
              }
            },
            required: ['name']
          },
          description: '服务列表'
        },
        networks: {
          type: 'object',
          description: '网络配置'
        },
        volumes: {
          type: 'object',
          description: '卷配置'
        }
      },
      required: ['projectPath', 'services']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: '生成Web应用Docker Compose配置',
        params: {
          projectPath: './my-web-app',
          services: [
            {
              name: 'web',
              build: '.',
              ports: ['3000:3000'],
              environment: {
                NODE_ENV: 'production'
              }
            },
            {
              name: 'db',
              image: 'postgres:15',
              environment: {
                POSTGRES_PASSWORD: 'password',
                POSTGRES_DB: 'myapp'
              },
              volumes: ['db-data:/var/lib/postgresql/data']
            }
          ]
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_gitignore_generator',
    name: 'gitignore_generator',
    display_name: '.gitignore生成器',
    description: '生成适合不同项目类型的.gitignore文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        templates: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'Node',
              'Python',
              'Java',
              'Go',
              'VisualStudioCode',
              'JetBrains',
              'macOS',
              'Windows',
              'Linux'
            ]
          },
          description: '模板列表'
        },
        customPatterns: {
          type: 'array',
          items: {
            type: 'string'
          },
          description: '自定义忽略模式'
        }
      },
      required: ['projectPath', 'templates']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        },
        patterns: {
          type: 'number'
        }
      }
    },
    examples: [
      {
        description: '.gitignore生成器基础用法',
        params: {
          projectPath: './data/sample.dat',
          templates: ['item1', 'item2'],
          customPatterns: ['item1', 'item2']
        }
      },
      {
        description: '.gitignore生成器高级用法',
        params: {
          projectPath: './advanced_data/sample.dat',
          templates: ['item1', 'item2', 'item3', 'item4'],
          customPatterns: ['item1', 'item2', 'item3', 'item4']
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_eslint_config_generator',
    name: 'eslint_config_generator',
    display_name: 'ESLint配置生成器',
    description: '生成ESLint配置文件',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: '项目路径'
        },
        framework: {
          type: 'string',
          enum: ['react', 'vue', 'angular', 'node', 'typescript'],
          description: '框架类型'
        },
        style: {
          type: 'string',
          enum: ['airbnb', 'standard', 'google', 'custom'],
          default: 'airbnb',
          description: '代码风格'
        },
        configFormat: {
          type: 'string',
          enum: ['js', 'json', 'yaml'],
          default: 'js',
          description: '配置文件格式'
        }
      },
      required: ['projectPath', 'framework']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean'
        },
        filePath: {
          type: 'string'
        }
      }
    },
    examples: [
      {
        description: 'ESLint配置生成器基础用法',
        params: {
          projectPath: './data/sample.dat',
          framework: 'react',
          style: 'airbnb',
          configFormat: 'js'
        }
      },
      {
        description: 'ESLint配置生成器高级用法',
        params: {
          projectPath: './advanced_data/sample.dat',
          framework: 'vue',
          style: 'standard',
          configFormat: 'json'
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_contract_analyzer',
    name: 'contract_analyzer',
    display_name: '智能合约分析器 / Smart Contract Analyzer',
    description: '分析智能合约代码，检测安全漏洞、gas优化建议和最佳实践',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        contractCode: {
          type: 'string',
          description: '智能合约源代码'
        },
        analysisDepth: {
          type: 'string',
          description: '分析深度',
          enum: ['basic', 'comprehensive'],
          default: 'comprehensive'
        },
        securityFocus: {
          type: 'boolean',
          description: '是否重点检查安全问题',
          default: true
        }
      },
      required: ['contractCode']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        issues: {
          type: 'array',
          description: 'array of security issues',
          items: {
            type: 'object'
          }
        },
        optimizations: {
          type: 'array',
          description: 'array of optimization suggestions',
          items: {
            type: 'object'
          }
        },
        bestPractices: {
          type: 'array',
          description: 'array of best practice recommendations',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '分析Solidity智能合约',
        params: {
          contractCode: 'pragma solidity ^0.8.0; contract MyToken { ... }',
          analysisDepth: 'comprehensive',
          securityFocus: true
        }
      }
    ],
    required_permissions: ['code:analyze'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_blockchain_query',
    name: 'blockchain_query',
    display_name: '区块链查询工具 / Blockchain Query Tool',
    description: '查询区块链数据，包括交易、区块、地址余额等信息',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        chain: {
          type: 'string',
          description: '区块链网络',
          enum: ['ethereum', 'bsc', 'polygon'],
          default: 'ethereum'
        },
        queryType: {
          type: 'string',
          description: '查询类型',
          enum: ['transaction', 'block', 'address', 'balance']
        },
        identifier: {
          type: 'string',
          description: '查询标识符（交易哈希/区块号/地址）'
        }
      },
      required: ['queryType', 'identifier']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: '查询结果'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '区块链查询工具 基础用法',
        params: {
          chain: 'ethereum',
          queryType: '搜索关键词',
          identifier: 'value'
        }
      },
      {
        description: '区块链查询工具 高级用法',
        params: {
          chain: 'bsc',
          queryType: '复杂查询：条件A AND 条件B',
          identifier: 'advanced_value'
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_tokenomics_simulator',
    name: 'tokenomics_simulator',
    display_name: '代币经济模拟器 / Tokenomics Simulator',
    description: '模拟代币经济模型的长期表现，包括供需、价格、流通等',
    category: 'blockchain',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        tokenConfig: {
          type: 'object',
          description: '代币配置（总量、分配等）'
        },
        simulationPeriod: {
          type: 'string',
          description: '模拟周期',
          default: '5years'
        },
        iterations: {
          type: 'number',
          description: '模拟迭代次数',
          default: 1000
        }
      },
      required: ['tokenConfig']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        simulations: {
          type: 'array',
          description: 'array of simulation results',
          items: {
            type: 'object'
          }
        },
        summary: {
          type: 'object',
          description: '统计摘要'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '代币经济模拟器 基础用法',
        params: {
          tokenConfig: 'value',
          simulationPeriod: '5years',
          iterations: 10
        }
      },
      {
        description: '代币经济模拟器 高级用法',
        params: {
          tokenConfig: 'advanced_value',
          simulationPeriod: '5years',
          iterations: 50
        }
      }
    ],
    required_permissions: ['compute:intensive'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_legal_template_generator',
    name: 'legal_template_generator',
    display_name: '法律文书生成器 / Legal Template Generator',
    description: '生成各类法律文书模板，包括合同、协议、申请书等',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        templateType: {
          type: 'string',
          description: '文书类型',
          enum: ['contract', 'agreement', 'notice', 'application']
        },
        jurisdiction: {
          type: 'string',
          description: '法律管辖区',
          default: 'CN'
        },
        variables: {
          type: 'object',
          description: '模板变量'
        }
      },
      required: ['templateType', 'variables']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        document: {
          type: 'string',
          description: '生成的法律文书'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '生成劳动合同',
        params: {
          templateType: 'contract',
          jurisdiction: 'CN',
          variables: {
            employeeName: '张三',
            position: '软件工程师',
            startDate: '2024-01-01'
          }
        }
      }
    ],
    required_permissions: ['file:write'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_patent_claim_analyzer',
    name: 'claim_analyzer',
    display_name: '专利权利要求分析器 / Patent Claim Analyzer',
    description: '分析专利权利要求的保护范围、新颖性和创造性',
    category: 'legal',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        claimText: {
          type: 'string',
          description: '专利权利要求文本'
        },
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['basic', 'comprehensive'],
          default: 'comprehensive'
        }
      },
      required: ['claimText']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        analysis: {
          type: 'object',
          description: '分析结果'
        },
        suggestions: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '分析专利权利要求',
        params: {
          claimText: '一种智能手机的触摸屏组件，其特征在于...',
          analysisType: 'comprehensive'
        }
      }
    ],
    required_permissions: ['text:analyze'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_market_data_analyzer',
    name: 'market_data_analyzer',
    display_name: '市场数据分析器 / Market Data Analyzer',
    description: '分析市场数据，包括价格趋势、供需关系、竞争格局等',
    category: 'analysis',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        market: {
          type: 'string',
          description: '市场名称'
        },
        dataSources: {
          type: 'array',
          description: '数据源',
          default: ['multiple']
        },
        metrics: {
          type: 'array',
          description: '分析指标',
          default: ['price', 'volume', 'trend']
        }
      },
      required: ['market']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        analysis: {
          type: 'object',
          description: 'object'
        },
        trends: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '分析股票市场',
        params: {
          market: 'AAPL',
          metrics: ['price', 'volume', 'trend']
        }
      }
    ],
    required_permissions: ['network:request'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_real_estate_calculator',
    name: 'real_estate_calculator',
    display_name: '房地产财务计算器 / Real Estate Financial Calculator',
    description: '计算房地产项目的IRR、NPV、现金流等财务指标',
    category: 'finance',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectData: {
          type: 'object',
          description: '项目数据（成本、收入、周期等）'
        },
        discountRate: {
          type: 'number',
          description: '折现率',
          default: 0.08
        },
        currency: {
          type: 'string',
          description: '货币单位',
          default: 'CNY'
        }
      },
      required: ['projectData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        irr: {
          type: 'number',
          description: '内部收益率'
        },
        npv: {
          type: 'number',
          description: '净现值'
        },
        cashFlows: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '计算房地产项目IRR和NPV',
        params: {
          projectData: {
            investment: 10000000,
            revenues: [2000000, 3000000, 4000000, 5000000],
            costs: [500000, 600000, 700000, 800000]
          },
          discountRate: 0.08
        }
      }
    ],
    required_permissions: ['compute:intensive'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_customer_health_scorer',
    name: 'health_score_calculator',
    display_name: '客户健康度评分器 / Customer Health Score Calculator',
    description: '计算客户健康度评分，预测续约风险和扩展机会',
    category: 'crm',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        customerData: {
          type: 'object',
          description: '客户数据'
        },
        scoringModel: {
          type: 'string',
          description: '评分模型',
          enum: ['simple', 'weighted', 'ml'],
          default: 'weighted'
        }
      },
      required: ['customerData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        healthScore: {
          type: 'number',
          description: '健康度评分（0-100）'
        },
        riskLevel: {
          type: 'string',
          description: 'string'
        },
        recommendations: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '计算客户健康度评分',
        params: {
          customerData: {
            usage: 85,
            engagement: 90,
            support_tickets: 2,
            nps_score: 8
          },
          scoringModel: 'weighted'
        }
      }
    ],
    required_permissions: ['data:analyze'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_churn_predictor',
    name: 'churn_predictor',
    display_name: '客户流失预测器 / Churn Predictor',
    description: '基于客户行为数据预测流失风险，提供挽留建议',
    category: 'crm',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        customerData: {
          type: 'object',
          description: '客户行为数据'
        },
        modelType: {
          type: 'string',
          description: '预测模型类型',
          enum: ['simple', 'ml'],
          default: 'ml'
        },
        predictionWindow: {
          type: 'string',
          description: '预测窗口期',
          default: '90days'
        }
      },
      required: ['customerData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        churnProbability: {
          type: 'number',
          description: '流失概率（0-1）'
        },
        riskFactors: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        recommendations: {
          type: 'array',
          description: 'array',
          items: {
            type: 'object'
          }
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '预测客户流失风险',
        params: {
          customerData: {
            last_login_days: 30,
            usage_decline: 0.5,
            support_tickets: 5,
            payment_delays: 2
          },
          modelType: 'ml'
        }
      }
    ],
    required_permissions: ['data:analyze', 'ml:predict'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_stakeholder_mapper',
    name: 'stakeholder_analyzer',
    display_name: '利益相关者映射工具 / Stakeholder Mapping Tool',
    description: '分析和映射项目利益相关者，生成权力-利益矩阵',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectData: {
          type: 'object',
          description: '项目数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['projectData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '利益相关者映射工具 基础用法',
        params: {
          projectData: 'value',
          options: 'value'
        }
      },
      {
        description: '利益相关者映射工具 高级用法',
        params: {
          projectData: 'advanced_value',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['data:read', 'data:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_change_readiness_assessor',
    name: 'readiness_assessor',
    display_name: '变革准备度评估器 / Change Readiness Assessor',
    description: '评估组织的变革准备度，使用ADKAR或其他框架',
    category: 'management',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用变革准备度评估器 / Change Readiness Assessor',
        params: {}
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_communication_planner',
    name: 'communication_planner',
    display_name: '沟通计划工具 / Communication Planner',
    description: '规划项目沟通策略，生成沟通矩阵和时间表',
    category: 'project',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        projectData: {
          type: 'object',
          description: '项目数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['projectData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '沟通计划工具 基础用法',
        params: {
          projectData: 'value',
          options: 'value'
        }
      },
      {
        description: '沟通计划工具 高级用法',
        params: {
          projectData: 'advanced_value',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['data:read', 'data:write'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_org_chart_generator',
    name: 'org_chart_generator',
    display_name: '组织架构图生成器 / Organization Chart Generator',
    description: '生成组织架构图，支持多种格式和样式',
    category: 'hr',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        organizationData: {
          type: 'object',
          description: '组织数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['organizationData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用组织架构图生成器 / Organization Chart Generator',
        params: {}
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_culture_analyzer',
    name: 'culture_analyzer',
    display_name: '企业文化分析器 / Culture Analyzer',
    description: '分析企业文化现状，识别文化差距和改进机会',
    category: 'hr',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        organizationData: {
          type: 'object',
          description: '组织数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['organizationData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用企业文化分析器 / Culture Analyzer',
        params: {}
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_event_timeline_creator',
    name: 'event_timeline_generator',
    display_name: '活动时间线生成器 / Event Timeline Generator',
    description: '创建活动执行时间线，包括里程碑和关键任务',
    category: 'event',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用活动时间线生成器 / Event Timeline Generator',
        params: {}
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_press_release_generator',
    name: 'press_release_generator',
    display_name: '新闻稿生成器 / Press Release Generator',
    description: '生成专业新闻稿，符合媒体发布标准',
    category: 'marketing',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '内容'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用新闻稿生成器 / Press Release Generator',
        params: {}
      }
    ],
    required_permissions: ['text:generate'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_media_list_manager',
    name: 'media_list_manager',
    display_name: '媒体列表管理器 / Media List Manager',
    description: '管理媒体联系人列表，分类和追踪媒体关系',
    category: 'marketing',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '内容'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用媒体列表管理器 / Media List Manager',
        params: {}
      }
    ],
    required_permissions: ['text:generate'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_sentiment_analyzer',
    name: 'sentiment_analyzer',
    display_name: '舆情分析器 / Sentiment Analyzer',
    description: '分析社交媒体和新闻的情感倾向，监测品牌声誉',
    category: 'marketing',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '内容'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['content']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用舆情分析器 / Sentiment Analyzer',
        params: {}
      }
    ],
    required_permissions: ['text:generate'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_audit_risk_assessor',
    name: 'risk_assessor',
    display_name: '审计风险评估器 / Audit Risk Assessor',
    description: '评估审计风险，确定审计重点和资源分配',
    category: 'audit',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        auditData: {
          type: 'object',
          description: '审计数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['auditData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用审计风险评估器 / Audit Risk Assessor',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'data:analyze'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_control_effectiveness_evaluator',
    name: 'control_evaluator',
    display_name: '内部控制评价器 / Control Effectiveness Evaluator',
    description: '评价内部控制的设计和执行有效性',
    category: 'audit',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        auditData: {
          type: 'object',
          description: '审计数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['auditData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用内部控制评价器 / Control Effectiveness Evaluator',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'data:analyze'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_code_generator',
    name: 'code_generator',
    display_name: '代码生成器 / Code Generator',
    description: '生成各类编程语言代码，支持函数、类、模块等多种代码结构',
    category: 'code',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        codeSpec: {
          type: 'object',
          description: '代码规格'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['codeSpec']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '处理简单代码',
        params: {
          codeSpec: 'value',
          options: 'value'
        }
      },
      {
        description: '处理复杂项目',
        params: {
          codeSpec: 'advanced_value',
          options: 'advanced_value'
        }
      }
    ],
    required_permissions: ['code:generate'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_financial_calculator',
    name: 'financial_calculator',
    display_name: '财务计算器 / Financial Calculator',
    description: '计算各类财务指标，包括NPV、IRR、ROI、现值、终值等',
    category: 'finance',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        financialData: {
          type: 'object',
          description: '财务数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['financialData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用财务计算器 / Financial Calculator',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'compute:intensive'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_simulation_runner',
    name: 'simulation_runner',
    display_name: '模拟运行器 / Simulation Runner',
    description: '运行各类业务模拟场景，支持蒙特卡洛模拟、敏感性分析等',
    category: 'analysis',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用模拟运行器 / Simulation Runner',
        params: {}
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_crm_integrator',
    name: 'crm_integrator',
    display_name: 'CRM集成器 / CRM Integrator',
    description: '集成主流CRM系统（Salesforce、HubSpot、Zoho等），同步客户数据',
    category: 'crm',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        crmData: {
          type: 'object',
          description: 'CRM数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['crmData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用CRM集成器 / CRM Integrator',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'network:request'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_competency_framework',
    name: 'competency_framework',
    display_name: '能力框架工具 / Competency Framework Tool',
    description: '构建和管理企业能力素质模型，定义岗位能力要求',
    category: 'hr',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        organizationData: {
          type: 'object',
          description: '组织数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['organizationData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用能力框架工具 / Competency Framework Tool',
        params: {}
      }
    ],
    required_permissions: ['data:read'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_budget_calculator',
    name: 'budget_calculator',
    display_name: '预算计算器 / Budget Calculator',
    description: '计算和管理项目预算，支持成本分解、预算跟踪、差异分析',
    category: 'finance',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        financialData: {
          type: 'object',
          description: '财务数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['financialData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用预算计算器 / Budget Calculator',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'compute:intensive'],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_vendor_manager',
    name: 'vendor_manager',
    display_name: '供应商管理器 / Vendor Manager',
    description: '管理供应商信息、合同、绩效评估、付款跟踪',
    category: 'procurement',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: []
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用供应商管理器 / Vendor Manager',
        params: {}
      }
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1
  },
  {
    id: 'tool_evidence_documenter',
    name: 'evidence_documenter',
    display_name: '证据记录器 / Evidence Documenter',
    description: '记录和管理审计证据，支持文档归档、标记、溯源',
    category: 'audit',
    tool_type: 'function',
    parameters_schema: {
      type: 'object',
      properties: {
        auditData: {
          type: 'object',
          description: '审计数据'
        },
        options: {
          type: 'object',
          description: '配置选项'
        }
      },
      required: ['auditData']
    },
    return_schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'boolean'
        },
        data: {
          type: 'object',
          description: 'object'
        },
        error: {
          type: 'string',
          description: 'string'
        }
      }
    },
    examples: [
      {
        description: '使用证据记录器 / Evidence Documenter',
        params: {}
      }
    ],
    required_permissions: ['data:read', 'data:analyze'],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1
  }
];

module.exports = tools;