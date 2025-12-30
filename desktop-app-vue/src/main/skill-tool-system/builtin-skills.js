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
  },

  // === 第二批新增技能 (26-35) ===

  {
    "id": "skill_code_quality",
    "name": "代码质量",
    "display_name": "Code Quality",
    "description": "代码格式化、diff比较、版本管理",
    "category": "code",
    "icon": "check-circle",
    "tags": "[\"代码\",\"质量\",\"格式化\"]",
    "config": "{\"autoFormat\":true,\"strictMode\":false}",
    "doc_path": "docs/skills/code-quality.md",
    "tools": [
      "code_formatter",
      "diff_comparator",
      "version_comparator",
      "gitdiff_parser",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_config_parser",
    "name": "配置解析",
    "display_name": "Config Parser",
    "description": "解析和转换各种配置文件格式（XML/TOML/INI）",
    "category": "config",
    "icon": "file-text",
    "tags": "[\"配置\",\"解析\",\"格式\"]",
    "config": "{\"autoDetect\":true,\"preserveComments\":false}",
    "doc_path": "docs/skills/config-parser.md",
    "tools": [
      "xml_parser",
      "toml_parser",
      "ini_parser",
      "json_parser",
      "yaml_parser",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_web_scraping",
    "name": "网页抓取",
    "display_name": "Web Scraping",
    "description": "HTML解析、内容提取、网页数据采集",
    "category": "web",
    "icon": "spider",
    "tags": "[\"爬虫\",\"抓取\",\"HTML\"]",
    "config": "{\"userAgent\":\"Mozilla/5.0\",\"timeout\":10000,\"respectRobots\":true}",
    "doc_path": "docs/skills/web-scraping.md",
    "tools": [
      "http_client",
      "html_parser",
      "url_parser",
      "file_writer",
      "json_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_network_tools",
    "name": "网络工具",
    "display_name": "Network Tools",
    "description": "DNS查询、端口检测、IP工具、网络诊断",
    "category": "network",
    "icon": "radar-chart",
    "tags": "[\"网络\",\"DNS\",\"端口\"]",
    "config": "{\"timeout\":5000,\"retries\":3}",
    "doc_path": "docs/skills/network-tools.md",
    "tools": [
      "dns_lookup",
      "port_checker",
      "ip_utility",
      "http_client"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_security_tools",
    "name": "安全工具",
    "display_name": "Security Tools",
    "description": "Hash校验、JWT解析、文件完整性验证",
    "category": "security",
    "icon": "safety",
    "tags": "[\"安全\",\"验证\",\"JWT\"]",
    "config": "{\"defaultAlgorithm\":\"sha256\",\"strictMode\":true}",
    "doc_path": "docs/skills/security-tools.md",
    "tools": [
      "hash_verifier",
      "jwt_parser",
      "crypto_handler",
      "base64_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_text_utilities",
    "name": "文本工具",
    "display_name": "Text Utilities",
    "description": "编码检测、语言识别、Slug生成、邮件解析",
    "category": "text",
    "icon": "font-colors",
    "tags": "[\"文本\",\"编码\",\"语言\"]",
    "config": "{\"defaultEncoding\":\"utf-8\"}",
    "doc_path": "docs/skills/text-utilities.md",
    "tools": [
      "encoding_detector",
      "language_detector",
      "slug_generator",
      "email_parser",
      "text_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_qrcode_barcode",
    "name": "二维码条形码",
    "display_name": "QR & Barcode",
    "description": "生成QR二维码和条形码",
    "category": "image",
    "icon": "qrcode",
    "tags": "[\"二维码\",\"条形码\",\"生成\"]",
    "config": "{\"defaultSize\":256,\"errorLevel\":\"M\"}",
    "doc_path": "docs/skills/qrcode-barcode.md",
    "tools": [
      "qrcode_generator",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_task_scheduler",
    "name": "任务调度",
    "display_name": "Task Scheduler",
    "description": "Cron表达式解析、定时任务管理",
    "category": "automation",
    "icon": "schedule",
    "tags": "[\"定时\",\"调度\",\"Cron\"]",
    "config": "{\"timezone\":\"local\"}",
    "doc_path": "docs/skills/task-scheduler.md",
    "tools": [
      "cron_parser",
      "datetime_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_browser_automation",
    "name": "浏览器自动化",
    "display_name": "Browser Automation",
    "description": "User-Agent解析、浏览器指纹、自动化测试",
    "category": "automation",
    "icon": "chrome",
    "tags": "[\"浏览器\",\"自动化\",\"测试\"]",
    "config": "{\"headless\":true,\"defaultViewport\":{\"width\":1920,\"height\":1080}}",
    "doc_path": "docs/skills/browser-automation.md",
    "tools": [
      "useragent_parser",
      "http_client",
      "html_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_multi_format_data",
    "name": "多格式数据处理",
    "display_name": "Multi-Format Data",
    "description": "处理XML、HTML、TOML、INI等多种数据格式",
    "category": "data",
    "icon": "file-done",
    "tags": "[\"数据\",\"格式\",\"转换\"]",
    "config": "{\"autoConvert\":true,\"preserveStructure\":true}",
    "doc_path": "docs/skills/multi-format-data.md",
    "tools": [
      "xml_parser",
      "html_parser",
      "toml_parser",
      "ini_parser",
      "json_parser",
      "file_reader",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 第三批扩展技能 (36-45) ====================

  {
    "id": "skill_video_audio_processing",
    "name": "视频音频处理",
    "display_name": "Video & Audio Processing",
    "description": "视频音频元数据读取、格式转换、时长计算",
    "category": "media",
    "icon": "video-camera",
    "tags": "[\"视频\",\"音频\",\"媒体\",\"元数据\"]",
    "config": "{\"supportedFormats\":[\"mp4\",\"mp3\",\"wav\",\"avi\",\"mkv\"],\"maxFileSize\":\"500MB\"}",
    "doc_path": "docs/skills/video-audio-processing.md",
    "tools": [
      "video_metadata_reader",
      "audio_duration_calculator",
      "subtitle_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_ml_inference",
    "name": "机器学习推理",
    "display_name": "Machine Learning Inference",
    "description": "加载和运行机器学习模型进行预测推理",
    "category": "ai",
    "icon": "robot",
    "tags": "[\"机器学习\",\"AI\",\"推理\",\"预测\"]",
    "config": "{\"modelPath\":\"\",\"framework\":\"onnx\"}",
    "doc_path": "docs/skills/ml-inference.md",
    "tools": [
      "model_predictor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_data_analytics",
    "name": "数据分析统计",
    "display_name": "Data Analytics",
    "description": "数据聚合、统计分析、图表数据生成",
    "category": "data",
    "icon": "bar-chart",
    "tags": "[\"数据分析\",\"统计\",\"图表\",\"可视化\"]",
    "config": "{\"precision\":2,\"chartTypes\":[\"line\",\"bar\",\"pie\"]}",
    "doc_path": "docs/skills/data-analytics.md",
    "tools": [
      "data_aggregator",
      "statistical_calculator",
      "chart_data_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_document_templating",
    "name": "文档模板生成",
    "display_name": "Document Templating",
    "description": "支持 Mustache、Handlebars、EJS 等模板引擎",
    "category": "document",
    "icon": "file-text",
    "tags": "[\"模板\",\"文档\",\"生成\",\"渲染\"]",
    "config": "{\"defaultEngine\":\"mustache\",\"escapeHtml\":true}",
    "doc_path": "docs/skills/document-templating.md",
    "tools": [
      "template_renderer",
      "file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_api_integration",
    "name": "API集成工具",
    "display_name": "API Integration",
    "description": "HTTP请求、OAuth认证、API调用管理",
    "category": "network",
    "icon": "api",
    "tags": "[\"API\",\"HTTP\",\"认证\",\"集成\"]",
    "config": "{\"timeout\":30000,\"retries\":3}",
    "doc_path": "docs/skills/api-integration.md",
    "tools": [
      "api_requester",
      "oauth_helper",
      "jwt_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_cloud_storage",
    "name": "云存储管理",
    "display_name": "Cloud Storage",
    "description": "支持 AWS S3、阿里云 OSS 等云存储服务",
    "category": "storage",
    "icon": "cloud",
    "tags": "[\"云存储\",\"S3\",\"OSS\",\"文件上传\"]",
    "config": "{\"provider\":\"s3\",\"region\":\"us-east-1\"}",
    "doc_path": "docs/skills/cloud-storage.md",
    "tools": [
      "s3_client",
      "oss_client"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_log_analysis",
    "name": "日志分析",
    "display_name": "Log Analysis",
    "description": "解析和分析各种日志格式（Nginx、Apache、JSON日志等）",
    "category": "devops",
    "icon": "file-search",
    "tags": "[\"日志\",\"分析\",\"监控\",\"调试\"]",
    "config": "{\"logFormats\":[\"nginx\",\"apache\",\"json\",\"syslog\"]}",
    "doc_path": "docs/skills/log-analysis.md",
    "tools": [
      "log_parser",
      "text_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_performance_monitoring",
    "name": "性能监控",
    "display_name": "Performance Monitoring",
    "description": "性能分析、内存监控、资源使用统计",
    "category": "devops",
    "icon": "dashboard",
    "tags": "[\"性能\",\"监控\",\"分析\",\"优化\"]",
    "config": "{\"sampleInterval\":1000,\"metricsRetention\":\"7d\"}",
    "doc_path": "docs/skills/performance-monitoring.md",
    "tools": [
      "performance_profiler",
      "memory_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_i18n_translation",
    "name": "国际化翻译",
    "display_name": "Internationalization",
    "description": "多语言翻译、本地化格式化、语言检测",
    "category": "text",
    "icon": "global",
    "tags": "[\"国际化\",\"翻译\",\"本地化\",\"多语言\"]",
    "config": "{\"defaultLocale\":\"zh-CN\",\"supportedLocales\":[\"en-US\",\"zh-CN\",\"ja-JP\"]}",
    "doc_path": "docs/skills/i18n-translation.md",
    "tools": [
      "translator",
      "locale_formatter",
      "language_detector"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_workflow_automation",
    "name": "工作流自动化",
    "display_name": "Workflow Automation",
    "description": "工作流编排、事件驱动、数据管道构建",
    "category": "automation",
    "icon": "branches",
    "tags": "[\"工作流\",\"自动化\",\"编排\",\"管道\"]",
    "config": "{\"maxConcurrent\":5,\"retryPolicy\":\"exponential\"}",
    "doc_path": "docs/skills/workflow-automation.md",
    "tools": [
      "workflow_executor",
      "event_emitter",
      "pipeline_builder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 第四批扩展技能 (46-55) ====================

  {
    "id": "skill_blockchain_integration",
    "name": "区块链集成",
    "display_name": "Blockchain Integration",
    "description": "与区块链网络交互、智能合约调用、钱包管理",
    "category": "blockchain",
    "icon": "link",
    "tags": "[\"区块链\",\"智能合约\",\"加密货币\",\"Web3\"]",
    "config": "{\"network\":\"ethereum\",\"chainId\":1}",
    "doc_path": "docs/skills/blockchain-integration.md",
    "tools": [
      "blockchain_client",
      "smart_contract_caller",
      "wallet_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_email_management",
    "name": "邮件管理",
    "display_name": "Email Management",
    "description": "发送邮件、读取邮件、处理附件",
    "category": "communication",
    "icon": "mail",
    "tags": "[\"邮件\",\"SMTP\",\"IMAP\",\"附件\"]",
    "config": "{\"provider\":\"smtp\",\"ssl\":true}",
    "doc_path": "docs/skills/email-management.md",
    "tools": [
      "email_sender",
      "email_reader",
      "email_attachment_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_pdf_processing",
    "name": "PDF处理",
    "display_name": "PDF Processing",
    "description": "PDF生成、文本提取、页面合并、表单填充",
    "category": "document",
    "icon": "file-pdf",
    "tags": "[\"PDF\",\"文档\",\"提取\",\"合并\"]",
    "config": "{\"quality\":\"high\",\"compression\":true}",
    "doc_path": "docs/skills/pdf-processing.md",
    "tools": [
      "pdf_generator",
      "pdf_text_extractor",
      "pdf_merger"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_speech_processing",
    "name": "语音处理",
    "display_name": "Speech Processing",
    "description": "语音识别、文本转语音、音频格式转换",
    "category": "media",
    "icon": "audio",
    "tags": "[\"语音\",\"TTS\",\"ASR\",\"音频转换\"]",
    "config": "{\"language\":\"zh-CN\",\"voice\":\"female\"}",
    "doc_path": "docs/skills/speech-processing.md",
    "tools": [
      "speech_recognizer",
      "text_to_speech",
      "audio_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_chart_visualization",
    "name": "图表可视化",
    "display_name": "Chart Visualization",
    "description": "生成各类图表（折线图、柱状图、饼图等）",
    "category": "visualization",
    "icon": "line-chart",
    "tags": "[\"图表\",\"可视化\",\"数据展示\",\"报表\"]",
    "config": "{\"theme\":\"default\",\"responsive\":true}",
    "doc_path": "docs/skills/chart-visualization.md",
    "tools": [
      "chart_renderer",
      "chart_data_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_web_scraping",
    "name": "网页爬虫",
    "display_name": "Web Scraping",
    "description": "网页数据爬取、HTML解析、内容提取",
    "category": "network",
    "icon": "spider",
    "tags": "[\"爬虫\",\"数据采集\",\"网页解析\",\"自动化\"]",
    "config": "{\"userAgent\":\"Mozilla/5.0\",\"timeout\":30000}",
    "doc_path": "docs/skills/web-scraping.md",
    "tools": [
      "web_crawler",
      "html_extractor",
      "html_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_data_validation",
    "name": "数据验证",
    "display_name": "Data Validation",
    "description": "数据校验、Schema验证、规则引擎",
    "category": "data",
    "icon": "check-circle",
    "tags": "[\"验证\",\"校验\",\"规则\",\"质量检查\"]",
    "config": "{\"strictMode\":true,\"autoConvert\":false}",
    "doc_path": "docs/skills/data-validation.md",
    "tools": [
      "data_validator",
      "schema_validator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_cache_management",
    "name": "缓存管理",
    "display_name": "Cache Management",
    "description": "缓存读写、过期管理、分布式缓存",
    "category": "storage",
    "icon": "database",
    "tags": "[\"缓存\",\"Redis\",\"内存\",\"性能优化\"]",
    "config": "{\"ttl\":3600,\"maxSize\":1000}",
    "doc_path": "docs/skills/cache-management.md",
    "tools": [
      "cache_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_message_queue",
    "name": "消息队列",
    "display_name": "Message Queue",
    "description": "消息发布订阅、队列管理、异步处理",
    "category": "messaging",
    "icon": "message",
    "tags": "[\"消息队列\",\"RabbitMQ\",\"Kafka\",\"异步\"]",
    "config": "{\"durable\":true,\"autoAck\":false}",
    "doc_path": "docs/skills/message-queue.md",
    "tools": [
      "message_queue_client"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_container_management",
    "name": "容器管理",
    "display_name": "Container Management",
    "description": "Docker容器操作、镜像管理、容器编排",
    "category": "devops",
    "icon": "container",
    "tags": "[\"Docker\",\"容器\",\"镜像\",\"编排\"]",
    "config": "{\"host\":\"unix:///var/run/docker.sock\"}",
    "doc_path": "docs/skills/container-management.md",
    "tools": [
      "docker_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];
