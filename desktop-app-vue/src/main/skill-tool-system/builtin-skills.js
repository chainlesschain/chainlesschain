/**
 * 内置技能定义
 * 定义系统内置的15个核心技能
 *
 * 注意：config 和 tags 必须是 JSON 字符串格式（符合数据库 schema）
 */

module.exports = [
  {
    "id": "skill_code_development",
    "name": "代码开发",
    "display_name": "Code Development",
    "description": "提供完整的代码开发能力，包括文件读写、代码生成和版本控制",
    "category": "code",
    "icon": "code",
    "tags": "[\"代码\",\"开发\",\"Git\"]",
    "config": "{\"defaultLanguage\":\"javascript\",\"autoFormat\":true,\"enableLinting\":false}",
    "doc_path": "docs/skills/code-development.md",
    "tools": [
      "file_reader",
      "file_writer",
      "file_editor",
      "create_project_structure",
      "git_init",
      "git_commit"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_web_development",
    "name": "Web开发",
    "display_name": "Web Development",
    "description": "创建网页、博客、单页应用等Web项目",
    "category": "web",
    "icon": "global",
    "tags": "[\"Web\",\"HTML\",\"CSS\",\"JavaScript\"]",
    "config": "{\"defaultTemplate\":\"blog\",\"responsive\":true}",
    "doc_path": "docs/skills/web-development.md",
    "tools": [
      "html_generator",
      "css_generator",
      "js_generator",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_data_analysis",
    "name": "数据分析",
    "display_name": "Data Analysis",
    "description": "读取CSV/Excel、数据清洗和可视化",
    "category": "data",
    "icon": "bar-chart",
    "tags": "[\"数据\",\"分析\",\"可视化\"]",
    "config": "{\"chartType\":\"auto\",\"exportFormat\":\"png\"}",
    "doc_path": "docs/skills/data-analysis.md",
    "tools": [
      "file_reader"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_content_creation",
    "name": "内容创作",
    "display_name": "Content Creation",
    "description": "写文章、文档编辑、Markdown处理",
    "category": "content",
    "icon": "edit",
    "tags": "[\"写作\",\"Markdown\",\"文档\"]",
    "config": "{\"defaultFormat\":\"markdown\"}",
    "doc_path": "docs/skills/content-creation.md",
    "tools": [
      "file_reader",
      "file_writer",
      "format_output"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_document_processing",
    "name": "文档处理",
    "display_name": "Document Processing",
    "description": "Word/PDF/Excel/PPT生成和编辑",
    "category": "document",
    "icon": "file-text",
    "tags": "[\"文档\",\"Office\",\"PDF\"]",
    "config": "{\"defaultFormat\":\"docx\"}",
    "doc_path": "docs/skills/document-processing.md",
    "tools": [
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_image_processing",
    "name": "图像处理",
    "display_name": "Image Processing",
    "description": "图片压缩、格式转换、OCR等",
    "category": "media",
    "icon": "picture",
    "tags": "[\"图片\",\"图像\",\"OCR\"]",
    "config": "{\"quality\":80,\"maxWidth\":1920}",
    "doc_path": "docs/skills/image-processing.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_video_processing",
    "name": "视频处理",
    "display_name": "Video Processing",
    "description": "视频剪辑、合并、格式转换",
    "category": "media",
    "icon": "video-camera",
    "tags": "[\"视频\",\"剪辑\"]",
    "config": "{\"format\":\"mp4\",\"quality\":\"high\"}",
    "doc_path": "docs/skills/video-processing.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_code_execution",
    "name": "代码执行",
    "display_name": "Code Execution",
    "description": "Python、Bash等代码执行和调试",
    "category": "code",
    "icon": "thunderbolt",
    "tags": "[\"执行\",\"Python\",\"Bash\"]",
    "config": "{\"timeout\":30000,\"sandbox\":true}",
    "doc_path": "docs/skills/code-execution.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_project_management",
    "name": "项目管理",
    "display_name": "Project Management",
    "description": "创建项目结构、Git版本控制",
    "category": "project",
    "icon": "project",
    "tags": "[\"项目\",\"Git\",\"管理\"]",
    "config": "{\"autoGit\":true}",
    "doc_path": "docs/skills/project-management.md",
    "tools": [
      "create_project_structure",
      "git_init",
      "git_commit",
      "info_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_knowledge_search",
    "name": "知识库搜索",
    "display_name": "Knowledge Search",
    "description": "知识库查询和RAG语义搜索",
    "category": "ai",
    "icon": "search",
    "tags": "[\"知识库\",\"RAG\",\"搜索\"]",
    "config": "{\"topK\":5,\"threshold\":0.7}",
    "doc_path": "docs/skills/knowledge-search.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_template_application",
    "name": "模板应用",
    "display_name": "Template Application",
    "description": "使用模板创建项目和内容",
    "category": "template",
    "icon": "layout",
    "tags": "[\"模板\",\"快速创建\"]",
    "config": "{\"defaultCategory\":\"writing\"}",
    "doc_path": "docs/skills/template-application.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_system_operations",
    "name": "系统操作",
    "display_name": "System Operations",
    "description": "文件系统操作和通用处理",
    "category": "system",
    "icon": "setting",
    "tags": "[\"系统\",\"文件\"]",
    "config": "{}",
    "doc_path": "docs/skills/system-operations.md",
    "tools": [
      "file_reader",
      "file_writer",
      "generic_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_network_requests",
    "name": "网络请求",
    "display_name": "Network Requests",
    "description": "HTTP请求、API调用、网页抓取",
    "category": "network",
    "icon": "api",
    "tags": "[\"网络\",\"HTTP\",\"API\"]",
    "config": "{\"timeout\":10000,\"retry\":3}",
    "doc_path": "docs/skills/network-requests.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_ai_conversation",
    "name": "AI对话",
    "display_name": "AI Conversation",
    "description": "LLM查询、Prompt模板填充",
    "category": "ai",
    "icon": "robot",
    "tags": "[\"AI\",\"LLM\",\"对话\"]",
    "config": "{\"temperature\":0.7,\"maxTokens\":2000}",
    "doc_path": "docs/skills/ai-conversation.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_automation_workflow",
    "name": "自动化工作流",
    "display_name": "Automation Workflow",
    "description": "任务链执行和条件判断",
    "category": "automation",
    "icon": "branches",
    "tags": "[\"自动化\",\"工作流\"]",
    "config": "{\"maxSteps\":50,\"errorHandling\":\"continue\"}",
    "doc_path": "docs/skills/automation-workflow.md",
    "tools": [],
    "enabled": 1,
    "is_builtin": 1
  },

  // === 新增技能 (16-25) ===

  {
    "id": "skill_data_transformation",
    "name": "数据转换",
    "display_name": "Data Transformation",
    "description": "JSON/YAML/CSV/XML等格式互转和数据处理",
    "category": "data",
    "icon": "swap",
    "tags": "[\"数据\",\"转换\",\"格式化\"]",
    "config": "{\"autoDetectFormat\":true,\"preserveTypes\":true}",
    "doc_path": "docs/skills/data-transformation.md",
    "tools": [
      "json_parser",
      "yaml_parser",
      "csv_handler",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_text_processing",
    "name": "文本处理",
    "display_name": "Text Processing",
    "description": "文本分析、正则匹配、格式转换等高级文本操作",
    "category": "text",
    "icon": "font-size",
    "tags": "[\"文本\",\"分析\",\"正则\"]",
    "config": "{\"encoding\":\"utf8\",\"lineEnding\":\"auto\"}",
    "doc_path": "docs/skills/text-processing.md",
    "tools": [
      "text_analyzer",
      "regex_tester",
      "markdown_converter",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_encryption_security",
    "name": "加密安全",
    "display_name": "Encryption & Security",
    "description": "数据加密、哈希计算、Base64编解码等安全操作",
    "category": "security",
    "icon": "lock",
    "tags": "[\"加密\",\"安全\",\"哈希\"]",
    "config": "{\"defaultAlgorithm\":\"sha256\",\"secureRandom\":true}",
    "doc_path": "docs/skills/encryption-security.md",
    "tools": [
      "crypto_handler",
      "base64_handler",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_api_integration",
    "name": "API集成",
    "display_name": "API Integration",
    "description": "HTTP请求、RESTful API调用、数据同步",
    "category": "network",
    "icon": "cloud",
    "tags": "[\"API\",\"HTTP\",\"集成\"]",
    "config": "{\"timeout\":30000,\"retryCount\":3,\"followRedirects\":true}",
    "doc_path": "docs/skills/api-integration.md",
    "tools": [
      "http_client",
      "url_parser",
      "json_parser",
      "format_output"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_database_operations",
    "name": "数据库操作",
    "display_name": "Database Operations",
    "description": "SQL查询构建、数据导入导出、数据库管理",
    "category": "database",
    "icon": "database",
    "tags": "[\"数据库\",\"SQL\",\"查询\"]",
    "config": "{\"autoCommit\":true,\"batchSize\":1000}",
    "doc_path": "docs/skills/database-operations.md",
    "tools": [
      "sql_builder",
      "csv_handler",
      "excel_reader",
      "json_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_file_compression",
    "name": "文件压缩",
    "display_name": "File Compression",
    "description": "ZIP压缩解压、批量文件打包",
    "category": "file",
    "icon": "file-zip",
    "tags": "[\"压缩\",\"ZIP\",\"归档\"]",
    "config": "{\"compressionLevel\":6,\"preservePermissions\":true}",
    "doc_path": "docs/skills/file-compression.md",
    "tools": [
      "zip_handler",
      "file_searcher",
      "file_reader"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_format_conversion",
    "name": "格式转换",
    "display_name": "Format Conversion",
    "description": "Markdown、HTML、PDF等文档格式互转",
    "category": "document",
    "icon": "file-sync",
    "tags": "[\"格式转换\",\"文档\",\"导出\"]",
    "config": "{\"preserveStyles\":true,\"embedImages\":false}",
    "doc_path": "docs/skills/format-conversion.md",
    "tools": [
      "markdown_converter",
      "html_generator",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_configuration_management",
    "name": "配置管理",
    "display_name": "Configuration Management",
    "description": "环境变量、配置文件管理和验证",
    "category": "config",
    "icon": "tool",
    "tags": "[\"配置\",\"环境变量\",\"设置\"]",
    "config": "{\"validateSchema\":true,\"backupBeforeChange\":true}",
    "doc_path": "docs/skills/configuration-management.md",
    "tools": [
      "env_manager",
      "json_parser",
      "yaml_parser",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_datetime_operations",
    "name": "日期时间操作",
    "display_name": "DateTime Operations",
    "description": "日期计算、格式化、时区转换",
    "category": "utility",
    "icon": "clock-circle",
    "tags": "[\"日期\",\"时间\",\"格式化\"]",
    "config": "{\"defaultFormat\":\"YYYY-MM-DD HH:mm:ss\",\"timezone\":\"local\"}",
    "doc_path": "docs/skills/datetime-operations.md",
    "tools": [
      "datetime_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_batch_processing",
    "name": "批量处理",
    "display_name": "Batch Processing",
    "description": "批量文件操作、数据处理和转换",
    "category": "automation",
    "icon": "block",
    "tags": "[\"批量\",\"自动化\",\"处理\"]",
    "config": "{\"maxConcurrent\":5,\"continueOnError\":true,\"progressCallback\":true}",
    "doc_path": "docs/skills/batch-processing.md",
    "tools": [
      "file_searcher",
      "file_reader",
      "file_writer",
      "file_editor",
      "format_output"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];
