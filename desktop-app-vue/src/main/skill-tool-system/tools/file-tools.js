/**
 * file-tools - Auto-generated from builtin-tools.js split
 * 32 tools
 */

module.exports = [
  {
    id: "tool_file_reader",
    name: "file_reader",
    display_name: "文件读取",
    description: "读取指定路径的文件内容",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "要读取的文件路径",
        },
      },
      required: ["filePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        content: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "读取文本配置文件",
        params: {
          filePath: "./config/app.json",
          encoding: "utf-8",
        },
      },
      {
        description: "读取日志文件最后1000行",
        params: {
          filePath: "/var/log/application.log",
          encoding: "utf-8",
          lines: 1000,
        },
      },
      {
        description: "读取二进制数据文件",
        params: {
          filePath: "./data/binary.dat",
          encoding: "binary",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_writer",
    name: "file_writer",
    display_name: "文件写入",
    description: "将内容写入到指定路径的文件",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "文件路径",
        },
        content: {
          type: "string",
          description: "要写入的内容",
        },
      },
      required: ["filePath", "content"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        size: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "文件写入基础用法",
        params: {
          filePath: "./data/sample.dat",
          content: "示例文本",
        },
      },
      {
        description: "文件写入高级用法",
        params: {
          filePath: "./advanced_data/sample.dat",
          content: "更复杂的示例文本内容，用于测试高级功能",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_editor",
    name: "file_editor",
    display_name: "文件编辑",
    description: "编辑现有文件内容",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "文件路径",
        },
        operations: {
          type: "array",
          description: "编辑操作列表",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["replace", "insert", "delete"],
              },
              search: {
                type: "string",
              },
              replacement: {
                type: "string",
              },
              line: {
                type: "number",
              },
            },
          },
        },
      },
      required: ["filePath", "operations"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        changes: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "文件编辑基础用法",
        params: {
          filePath: "./data/sample.dat",
          operations: ["item1", "item2"],
        },
      },
      {
        description: "文件编辑高级用法",
        params: {
          filePath: "./advanced_data/sample.dat",
          operations: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_text_analyzer",
    name: "text_analyzer",
    display_name: "文本分析器",
    description: "统计文本字数、词频、句子数等",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要分析的文本",
        },
        options: {
          type: "object",
          description: "分析选项",
          properties: {
            wordFrequency: {
              type: "boolean",
              default: true,
            },
            sentiment: {
              type: "boolean",
              default: false,
            },
            keywords: {
              type: "boolean",
              default: false,
            },
          },
        },
      },
      required: ["text"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        stats: {
          type: "object",
          properties: {
            charCount: {
              type: "number",
            },
            wordCount: {
              type: "number",
            },
            sentenceCount: {
              type: "number",
            },
            lineCount: {
              type: "number",
            },
          },
        },
        wordFrequency: {
          type: "object",
        },
        keywords: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "分析文章情感倾向",
        params: {
          text: "这个产品非常好用，我很满意！",
          options: {
            sentiment: true,
            keywords: true,
          },
        },
      },
      {
        description: "分析文本统计信息",
        params: {
          text: "人工智能技术正在改变世界...",
          options: {
            wordCount: true,
            readability: true,
            language: "zh",
          },
        },
      },
      {
        description: "提取关键词和实体",
        params: {
          text: "苹果公司在加州库比蒂诺发布了新产品",
          options: {
            keywords: true,
            entities: true,
            limit: 10,
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_regex_tester",
    name: "regex_tester",
    display_name: "正则表达式测试器",
    description: "测试、匹配和替换正则表达式",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "正则表达式模式",
        },
        text: {
          type: "string",
          description: "要测试的文本",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["test", "match", "replace", "split"],
          default: "test",
        },
        replacement: {
          type: "string",
          description: "替换文本（用于replace）",
        },
        flags: {
          type: "string",
          description: "正则标志（g, i, m等）",
          default: "g",
        },
      },
      required: ["pattern", "text", "action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
        matches: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "使用正则表达式测试器处理短文本",
        params: {
          pattern: "example_value",
          text: "这是一段示例文本",
          action: "test",
          replacement: "example_value",
          flags: "g",
        },
      },
      {
        description: "使用正则表达式测试器处理长文本",
        params: {
          pattern: "example_value",
          text: "这是一段示例文本",
          action: "test",
          replacement: "example_value",
          flags: "g",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_zip_handler",
    name: "zip_handler",
    display_name: "ZIP压缩工具",
    description: "压缩和解压ZIP文件",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["compress", "extract", "list"],
          default: "compress",
        },
        source: {
          type: "string",
          description: "源文件或目录路径",
        },
        target: {
          type: "string",
          description: "目标ZIP文件路径",
        },
        password: {
          type: "string",
          description: "压缩密码（可选）",
        },
      },
      required: ["action", "source"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        zipPath: {
          type: "string",
        },
        files: {
          type: "array",
        },
        size: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "ZIP压缩工具基础用法",
        params: {
          action: "compress",
          source: "value",
          target: "value",
          password: "value",
        },
      },
      {
        description: "ZIP压缩工具高级用法",
        params: {
          action: "extract",
          source: "advanced_value",
          target: "advanced_value",
          password: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_searcher",
    name: "file_searcher",
    display_name: "文件搜索器",
    description: "在目录中搜索文件和内容",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "搜索路径",
        },
        pattern: {
          type: "string",
          description: "文件名模式（支持通配符）",
        },
        content: {
          type: "string",
          description: "搜索内容（可选）",
        },
        recursive: {
          type: "boolean",
          description: "是否递归搜索",
          default: true,
        },
        maxDepth: {
          type: "number",
          description: "最大搜索深度",
          default: 10,
        },
      },
      required: ["path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        files: {
          type: "array",
        },
        count: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "在项目中搜索JavaScript文件",
        params: {
          directory: "./src",
          pattern: "*.js",
          recursive: true,
        },
      },
      {
        description: "搜索包含特定关键词的文件",
        params: {
          directory: "./docs",
          pattern: "*.md",
          content: "使用教程",
          recursive: true,
        },
      },
      {
        description: "搜索最近修改的文件",
        params: {
          directory: "./uploads",
          pattern: "*.*",
          modifiedAfter: "2025-01-01",
          recursive: false,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_diff_comparator",
    name: "diff_comparator",
    display_name: "Diff比较器",
    description: "比较两个文本或文件的差异",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text1: {
          type: "string",
          description: "第一个文本",
        },
        text2: {
          type: "string",
          description: "第二个文本",
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["unified", "side-by-side", "json"],
          default: "unified",
        },
        ignoreWhitespace: {
          type: "boolean",
          description: "忽略空白字符",
          default: false,
        },
      },
      required: ["text1", "text2"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        diff: {
          type: "string",
        },
        changes: {
          type: "number",
        },
        additions: {
          type: "number",
        },
        deletions: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "使用Diff比较器处理短文本",
        params: {
          text1: "这是一段示例文本",
          text2: "这是一段示例文本",
          format: "unified",
          ignoreWhitespace: false,
        },
      },
      {
        description: "使用Diff比较器处理长文本",
        params: {
          text1: "这是一段示例文本",
          text2: "这是一段示例文本",
          format: "unified",
          ignoreWhitespace: false,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_encoding_detector",
    name: "encoding_detector",
    display_name: "文本编码检测器",
    description: "检测文本或文件的字符编码",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "文件路径",
        },
        buffer: {
          type: "string",
          description: "Buffer数据（base64）",
        },
      },
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        encoding: {
          type: "string",
        },
        confidence: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "使用文本编码检测器处理短文本",
        params: {
          filePath: "./data/sample.dat",
          buffer: "example_value",
        },
      },
      {
        description: "使用文本编码检测器处理长文本",
        params: {
          filePath: "./data/sample.dat",
          buffer: "example_value",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_slug_generator",
    name: "slug_generator",
    display_name: "Slug生成器",
    description: "生成URL友好的slug字符串",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要转换的文本",
        },
        separator: {
          type: "string",
          description: "分隔符",
          default: "-",
        },
        lowercase: {
          type: "boolean",
          description: "是否转小写",
          default: true,
        },
      },
      required: ["text"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        slug: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用Slug生成器处理短文本",
        params: {
          text: "这是一段示例文本",
          separator: "-",
          lowercase: true,
        },
      },
      {
        description: "使用Slug生成器处理长文本",
        params: {
          text: "这是一段示例文本",
          separator: "-",
          lowercase: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_language_detector",
    name: "language_detector",
    display_name: "语言检测器",
    description: "检测文本的自然语言",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要检测的文本",
        },
      },
      required: ["text"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        language: {
          type: "string",
        },
        confidence: {
          type: "number",
        },
        alternatives: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "使用语言检测器处理短文本",
        params: {
          text: "这是一段示例文本",
        },
      },
      {
        description: "使用语言检测器处理长文本",
        params: {
          text: "这是一段示例文本",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_translator",
    name: "translator",
    display_name: "翻译器",
    description: "多语言文本翻译（支持主流语言）",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "要翻译的文本",
        },
        from: {
          type: "string",
          description: "源语言",
          default: "auto",
        },
        to: {
          type: "string",
          description: "目标语言",
        },
        service: {
          type: "string",
          description: "翻译服务",
          enum: ["google", "baidu", "youdao", "deepl"],
          default: "google",
        },
      },
      required: ["text", "to"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        translated: {
          type: "string",
        },
        detectedLanguage: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "翻译器基础用法",
        params: {
          text: "示例文本",
          from: "auto",
          to: "value",
          service: "google",
        },
      },
      {
        description: "翻译器高级用法",
        params: {
          text: "更复杂的示例文本内容，用于测试高级功能",
          from: "auto",
          to: "advanced_value",
          service: "baidu",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_locale_formatter",
    name: "locale_formatter",
    display_name: "本地化格式化器",
    description: "格式化日期、数字、货币等本地化内容",
    category: "text",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        value: {
          type: "any",
          description: "要格式化的值",
        },
        type: {
          type: "string",
          description: "格式化类型",
          enum: ["date", "time", "number", "currency", "percent"],
        },
        locale: {
          type: "string",
          description: "本地化标识符",
          default: "en-US",
        },
        options: {
          type: "object",
          description: "格式化选项",
        },
      },
      required: ["value", "type"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        formatted: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "格式化Markdown文档",
        params: {
          text: "# 标题\n\n这是内容",
          format: "markdown",
          options: {
            prettify: true,
          },
        },
      },
      {
        description: "格式化代码",
        params: {
          text: "function test(){return true;}",
          format: "javascript",
          options: {
            indent: 2,
            semicolons: true,
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pdf_generator",
    name: "pdf_generator",
    display_name: "PDF生成器",
    description: "从HTML、Markdown或模板生成PDF文件",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "内容（HTML或Markdown）",
        },
        contentType: {
          type: "string",
          description: "内容类型",
          enum: ["html", "markdown", "template"],
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        options: {
          type: "object",
          description: "PDF选项",
          properties: {
            format: {
              type: "string",
              default: "A4",
            },
            margin: {
              type: "object",
            },
            landscape: {
              type: "boolean",
            },
          },
        },
      },
      required: ["content", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          content: "示例文本",
          contentType: "示例文本",
          outputPath: "./output/result.json",
          options: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          contentType: "更复杂的示例文本内容，用于测试高级功能",
          outputPath: "./advanced_output/result.json",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pdf_text_extractor",
    name: "pdf_text_extractor",
    display_name: "PDF文本提取器",
    description: "从PDF文件中提取文本内容",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        pdfPath: {
          type: "string",
          description: "PDF文件路径",
        },
        pages: {
          type: "array",
          description: "要提取的页码（不指定则全部）",
          items: {
            type: "number",
          },
        },
        preserveLayout: {
          type: "boolean",
          description: "保持布局",
          default: false,
        },
      },
      required: ["pdfPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        text: {
          type: "string",
        },
        pageCount: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          pdfPath: "./data/sample.dat",
          pages: ["item1", "item2"],
          preserveLayout: false,
        },
      },
      {
        description: "批量处理文档",
        params: {
          pdfPath: "./advanced_data/sample.dat",
          pages: ["item1", "item2", "item3", "item4"],
          preserveLayout: true,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pdf_merger",
    name: "pdf_merger",
    display_name: "PDF合并器",
    description: "合并多个PDF文件、拆分PDF",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["merge", "split"],
        },
        inputFiles: {
          type: "array",
          description: "输入PDF文件列表",
          items: {
            type: "string",
          },
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        pageRanges: {
          type: "array",
          description: "页码范围（拆分时使用）",
        },
      },
      required: ["action", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        pageCount: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          action: "merge",
          inputFiles: "./input/data.json",
          outputPath: "./output/result.json",
          pageRanges: ["item1", "item2"],
        },
      },
      {
        description: "批量处理文档",
        params: {
          action: "split",
          inputFiles: "./advanced_input/data.json",
          outputPath: "./advanced_output/result.json",
          pageRanges: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_watcher",
    name: "file_watcher",
    display_name: "文件监视器",
    description: "监视文件变化（修改、创建、删除）",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["watch", "unwatch"],
        },
        path: {
          type: "string",
          description: "监视路径",
        },
        events: {
          type: "array",
          description: "监听事件",
          items: {
            type: "string",
            enum: ["change", "add", "unlink", "addDir", "unlinkDir"],
          },
        },
        callback: {
          type: "string",
          description: "回调函数ID",
        },
      },
      required: ["action", "path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        watcherId: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "文件监视器基础用法",
        params: {
          action: "watch",
          path: "./data/sample.dat",
          events: ["item1", "item2"],
          callback: "value",
        },
      },
      {
        description: "文件监视器高级用法",
        params: {
          action: "unwatch",
          path: "./advanced_data/sample.dat",
          events: ["item1", "item2", "item3", "item4"],
          callback: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:watch"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_directory_monitor",
    name: "directory_monitor",
    display_name: "目录监控器",
    description: "监控目录内文件变化",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "目录路径",
        },
        recursive: {
          type: "boolean",
          description: "是否递归监控子目录",
          default: true,
        },
        filter: {
          type: "string",
          description: "文件过滤规则（glob）",
        },
        debounce: {
          type: "number",
          description: "防抖延迟（毫秒）",
          default: 500,
        },
      },
      required: ["directory"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        monitorId: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "目录监控器基础用法",
        params: {
          directory: "value",
          recursive: false,
          filter: "value",
          debounce: 10,
        },
      },
      {
        description: "目录监控器高级用法",
        params: {
          directory: "advanced_value",
          recursive: true,
          filter: "advanced_value",
          debounce: 50,
        },
      },
    ],
    required_permissions: ["file:watch"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_compressor",
    name: "file_compressor",
    display_name: "文件压缩器",
    description: "压缩文件和文件夹为ZIP/RAR/7Z格式",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "待压缩文件列表",
          items: {
            type: "string",
          },
        },
        output_path: {
          type: "string",
          description: "输出压缩包路径",
        },
        format: {
          type: "string",
          description: "压缩格式",
          enum: ["zip", "rar", "7z", "tar.gz"],
        },
        compression_level: {
          type: "string",
          description: "压缩级别",
          enum: ["store", "fastest", "fast", "normal", "maximum", "ultra"],
        },
        password: {
          type: "string",
          description: "压缩包密码(可选)",
        },
        split_size: {
          type: "number",
          description: "分卷大小(MB, 可选)",
        },
      },
      required: ["files", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        archive_path: {
          type: "string",
        },
        compressed_size: {
          type: "number",
        },
        original_size: {
          type: "number",
        },
        compression_ratio: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "压缩单个文件",
        params: {
          inputPath: "./document.pdf",
          outputPath: "./document.pdf.gz",
          format: "gzip",
        },
      },
      {
        description: "压缩整个目录",
        params: {
          inputPath: "./project",
          outputPath: "./project-backup.zip",
          format: "zip",
          level: 9,
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_file_decompressor",
    name: "file_decompressor",
    display_name: "文件解压器",
    description: "解压ZIP/RAR/7Z等格式压缩包",
    category: "file",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        archive_path: {
          type: "string",
          description: "压缩包路径",
        },
        output_dir: {
          type: "string",
          description: "解压目标目录",
        },
        password: {
          type: "string",
          description: "密码(如果加密)",
        },
        overwrite: {
          type: "boolean",
          description: "是否覆盖已存在文件",
        },
        extract_files: {
          type: "array",
          description: "指定解压文件(可选)",
          items: {
            type: "string",
          },
        },
      },
      required: ["archive_path", "output_dir"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        extracted_files: {
          type: "array",
        },
        total_files: {
          type: "number",
        },
        total_size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "压缩单个文件",
        params: {
          inputPath: "./document.pdf",
          outputPath: "./document.pdf.gz",
          format: "gzip",
        },
      },
      {
        description: "压缩整个目录",
        params: {
          inputPath: "./project",
          outputPath: "./project-backup.zip",
          format: "zip",
          level: 9,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pdf_converter",
    name: "pdf_converter",
    display_name: "PDF转换器",
    description: "PDF与其他格式互转",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "输入文件路径",
        },
        output_path: {
          type: "string",
          description: "输出文件路径",
        },
        conversion_type: {
          type: "string",
          description: "转换类型",
          enum: ["to_pdf", "from_pdf"],
        },
        target_format: {
          type: "string",
          description: "目标格式",
          enum: ["pdf", "docx", "xlsx", "pptx", "txt", "html", "jpg", "png"],
        },
        options: {
          type: "object",
          description: "转换选项",
          properties: {
            preserve_layout: {
              type: "boolean",
            },
            ocr_enabled: {
              type: "boolean",
            },
            image_quality: {
              type: "number",
            },
          },
        },
      },
      required: ["input_path", "output_path", "target_format"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        pages: {
          type: "number",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          input_path: "./input/data.json",
          output_path: "./output/result.json",
          conversion_type: "to_pdf",
          target_format: "pdf",
          options: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          input_path: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          conversion_type: "from_pdf",
          target_format: "docx",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_office_converter",
    name: "office_converter",
    display_name: "Office文档转换器",
    description: "Word/Excel/PPT格式互转",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "输入文件路径",
        },
        output_path: {
          type: "string",
          description: "输出文件路径",
        },
        source_format: {
          type: "string",
          description: "源格式",
          enum: [
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "odt",
            "ods",
            "odp",
          ],
        },
        target_format: {
          type: "string",
          description: "目标格式",
          enum: [
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "pdf",
            "html",
            "txt",
          ],
        },
        preserve_formatting: {
          type: "boolean",
          description: "保留格式",
        },
      },
      required: ["input_path", "output_path", "target_format"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output_path: {
          type: "string",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          input_path: "./input/data.json",
          output_path: "./output/result.json",
          source_format: "doc",
          target_format: "doc",
          preserve_formatting: false,
        },
      },
      {
        description: "批量处理文档",
        params: {
          input_path: "./advanced_input/data.json",
          output_path: "./advanced_output/result.json",
          source_format: "docx",
          target_format: "docx",
          preserve_formatting: true,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_note_editor",
    name: "note_editor",
    display_name: "笔记编辑器",
    description: "Markdown笔记编辑和管理",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作",
          enum: ["create", "read", "update", "delete"],
        },
        note: {
          type: "object",
          description: "笔记信息",
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            content: {
              type: "string",
            },
            tags: {
              type: "array",
            },
            folder: {
              type: "string",
            },
            format: {
              type: "string",
              enum: ["markdown", "rich_text", "plain"],
            },
          },
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        note: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          action: "create",
          note: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          action: "read",
          note: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_note_searcher",
    name: "note_searcher",
    display_name: "笔记搜索器",
    description: "搜索和筛选笔记",
    category: "document",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词",
        },
        filters: {
          type: "object",
          description: "筛选条件",
          properties: {
            tags: {
              type: "array",
            },
            folder: {
              type: "string",
            },
            date_from: {
              type: "string",
            },
            date_to: {
              type: "string",
            },
            format: {
              type: "string",
            },
          },
        },
        sort_by: {
          type: "string",
          description: "排序方式",
          enum: ["created_at", "updated_at", "title", "relevance"],
        },
        limit: {
          type: "number",
          description: "返回数量限制",
        },
      },
      required: [],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        notes: {
          type: "array",
        },
        total: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          query: "搜索关键词",
          filters: "value",
          sort_by: "created_at",
          limit: 10,
        },
      },
      {
        description: "批量处理文档",
        params: {
          query: "复杂查询：条件A AND 条件B",
          filters: "advanced_value",
          sort_by: "updated_at",
          limit: 100,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_word_generator",
    name: "word_generator",
    display_name: "Word文档生成器",
    description: "生成Word文档（.docx格式），支持标题、段落、表格、图片",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "文档标题",
        },
        content: {
          type: "string",
          description: "文档内容（支持Markdown格式）",
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        template: {
          type: "string",
          description: "模板路径（可选）",
        },
        options: {
          type: "object",
          description: "文档选项",
          properties: {
            fontSize: {
              type: "number",
              default: 12,
            },
            fontFamily: {
              type: "string",
              default: "宋体",
            },
            lineSpacing: {
              type: "number",
              default: 1.5,
            },
            pageSize: {
              type: "string",
              enum: ["A4", "A5", "Letter"],
              default: "A4",
            },
            margin: {
              type: "object",
              properties: {
                top: {
                  type: "number",
                  default: 2.54,
                },
                bottom: {
                  type: "number",
                  default: 2.54,
                },
                left: {
                  type: "number",
                  default: 3.18,
                },
                right: {
                  type: "number",
                  default: 3.18,
                },
              },
            },
          },
        },
      },
      required: ["title", "content", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        fileSize: {
          type: "number",
        },
        pageCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          title: "value",
          content: "示例文本",
          outputPath: "./output/result.json",
          template: "value",
          options: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          title: "advanced_value",
          content: "更复杂的示例文本内容，用于测试高级功能",
          outputPath: "./advanced_output/result.json",
          template: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_word_table_creator",
    name: "word_table_creator",
    display_name: "Word表格创建器",
    description: "在Word文档中创建和格式化表格",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        documentPath: {
          type: "string",
          description: "Word文档路径",
        },
        tableData: {
          type: "object",
          description: "表格数据",
          properties: {
            headers: {
              type: "array",
              items: {
                type: "string",
              },
            },
            rows: {
              type: "array",
              items: {
                type: "array",
              },
            },
          },
          required: ["headers", "rows"],
        },
        style: {
          type: "string",
          enum: ["simple", "grid", "striped", "modern"],
          default: "grid",
          description: "表格样式",
        },
      },
      required: ["documentPath", "tableData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        tableCount: {
          type: "number",
        },
        rowCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          documentPath: "./data/sample.dat",
          tableData: "value",
          style: "simple",
        },
      },
      {
        description: "批量处理文档",
        params: {
          documentPath: "./advanced_data/sample.dat",
          tableData: "advanced_value",
          style: "grid",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_excel_generator",
    name: "excel_generator",
    display_name: "Excel电子表格生成器",
    description: "生成Excel文件（.xlsx格式），支持多工作表、公式、图表",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sheets: {
          type: "array",
          description: "工作表数组",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "工作表名称",
              },
              data: {
                type: "array",
                description: "二维数组数据",
                items: {
                  type: "array",
                },
              },
              headers: {
                type: "array",
                description: "表头（可选）",
                items: {
                  type: "string",
                },
              },
              columnWidths: {
                type: "array",
                description: "列宽数组",
                items: {
                  type: "number",
                },
              },
            },
            required: ["name", "data"],
          },
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        options: {
          type: "object",
          description: "Excel选项",
          properties: {
            creator: {
              type: "string",
              default: "ChainlessChain",
            },
            created: {
              type: "string",
            },
            autoFilter: {
              type: "boolean",
              default: false,
            },
            freeze: {
              type: "object",
              properties: {
                row: {
                  type: "number",
                },
                column: {
                  type: "number",
                },
              },
            },
          },
        },
      },
      required: ["sheets", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        sheetCount: {
          type: "number",
        },
        totalRows: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          sheets: ["item1", "item2"],
          outputPath: "./output/result.json",
          options: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          sheets: ["item1", "item2", "item3", "item4"],
          outputPath: "./advanced_output/result.json",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_excel_formula_builder",
    name: "excel_formula_builder",
    display_name: "Excel公式构建器",
    description: "生成和验证Excel公式",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        formulaType: {
          type: "string",
          enum: [
            "SUM",
            "AVERAGE",
            "IF",
            "VLOOKUP",
            "COUNTIF",
            "SUMIF",
            "CONCATENATE",
            "CUSTOM",
          ],
          description: "公式类型",
        },
        range: {
          type: "string",
          description: "单元格范围（例如：A1:A10）",
        },
        condition: {
          type: "string",
          description: "条件（用于IF、COUNTIF等）",
        },
        customFormula: {
          type: "string",
          description: "自定义公式（当formulaType为CUSTOM时）",
        },
      },
      required: ["formulaType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        formula: {
          type: "string",
        },
        description: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          formulaType: "SUM",
          range: "value",
          condition: "value",
          customFormula: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          formulaType: "AVERAGE",
          range: "advanced_value",
          condition: "advanced_value",
          customFormula: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_excel_chart_creator",
    name: "excel_chart_creator",
    display_name: "Excel图表创建器",
    description: "在Excel工作表中创建图表",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        workbookPath: {
          type: "string",
          description: "Excel文件路径",
        },
        sheetName: {
          type: "string",
          description: "工作表名称",
        },
        chartType: {
          type: "string",
          enum: ["line", "bar", "column", "pie", "area", "scatter", "doughnut"],
          description: "图表类型",
        },
        dataRange: {
          type: "string",
          description: "数据范围（例如：A1:D10）",
        },
        title: {
          type: "string",
          description: "图表标题",
        },
        position: {
          type: "object",
          description: "图表位置",
          properties: {
            row: {
              type: "number",
            },
            column: {
              type: "number",
            },
          },
        },
      },
      required: ["workbookPath", "sheetName", "chartType", "dataRange"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        chartId: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          workbookPath: "./data/sample.dat",
          sheetName: "value",
          chartType: "line",
          dataRange: "value",
          title: "value",
          position: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          workbookPath: "./advanced_data/sample.dat",
          sheetName: "advanced_value",
          chartType: "bar",
          dataRange: "advanced_value",
          title: "advanced_value",
          position: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ppt_generator",
    name: "ppt_generator",
    display_name: "PPT演示文稿生成器",
    description: "生成PowerPoint文件（.pptx格式）",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        slides: {
          type: "array",
          description: "幻灯片数组",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "幻灯片标题",
              },
              content: {
                type: "string",
                description: "幻灯片内容",
              },
              layout: {
                type: "string",
                enum: [
                  "title",
                  "titleAndContent",
                  "sectionHeader",
                  "twoContent",
                  "comparison",
                  "titleOnly",
                  "blank",
                ],
                description: "布局类型",
              },
              notes: {
                type: "string",
                description: "演讲者备注",
              },
            },
            required: ["title", "layout"],
          },
        },
        theme: {
          type: "string",
          enum: ["default", "modern", "professional", "creative", "minimal"],
          default: "default",
          description: "主题名称",
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        options: {
          type: "object",
          properties: {
            author: {
              type: "string",
            },
            company: {
              type: "string",
            },
            slideSize: {
              type: "string",
              enum: ["standard", "widescreen", "custom"],
              default: "widescreen",
            },
          },
        },
      },
      required: ["slides", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        slideCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          slides: ["item1", "item2"],
          theme: "default",
          outputPath: "./output/result.json",
          options: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          slides: ["item1", "item2", "item3", "item4"],
          theme: "modern",
          outputPath: "./advanced_output/result.json",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ppt_slide_creator",
    name: "ppt_slide_creator",
    display_name: "PPT幻灯片创建器",
    description: "向现有PowerPoint文件添加幻灯片",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        presentationPath: {
          type: "string",
          description: "PPT文件路径",
        },
        slide: {
          type: "object",
          description: "幻灯片配置",
          properties: {
            title: {
              type: "string",
            },
            content: {
              type: "string",
            },
            layout: {
              type: "string",
            },
            position: {
              type: "number",
              description: "插入位置（索引）",
            },
          },
          required: ["title", "layout"],
        },
      },
      required: ["presentationPath", "slide"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        slideIndex: {
          type: "number",
        },
        totalSlides: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          presentationPath: "./data/sample.dat",
          slide: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          presentationPath: "./advanced_data/sample.dat",
          slide: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ppt_theme_applicator",
    name: "ppt_theme_applicator",
    display_name: "PPT主题应用器",
    description: "为PowerPoint应用或修改主题样式",
    category: "office",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        presentationPath: {
          type: "string",
          description: "PPT文件路径",
        },
        theme: {
          type: "object",
          description: "主题配置",
          properties: {
            primaryColor: {
              type: "string",
              description: "主色调（十六进制）",
            },
            secondaryColor: {
              type: "string",
              description: "辅助色",
            },
            fontFamily: {
              type: "string",
              description: "字体",
            },
            backgroundStyle: {
              type: "string",
              enum: ["solid", "gradient", "image"],
              description: "背景样式",
            },
          },
        },
      },
      required: ["presentationPath", "theme"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        appliedSlides: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "处理单个文档",
        params: {
          presentationPath: "./data/sample.dat",
          theme: "value",
        },
      },
      {
        description: "批量处理文档",
        params: {
          presentationPath: "./advanced_data/sample.dat",
          theme: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
];
