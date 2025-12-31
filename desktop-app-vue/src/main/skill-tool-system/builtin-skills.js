/**
 * 内置技能定义
 * 定义系统内置的15个核心技能
 *
 * 注意：config 和 tags 必须是 JSON 字符串格式（符合数据库 schema）
 */


// 导入额外的技能定义
const additionalSkills = require('./additional-skills');

const builtinSkills = [
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
  },

  // ==================== 第五批扩展技能 (56-65) ====================

  {
    "id": "skill_cryptography",
    "name": "密码学工具",
    "display_name": "Cryptography",
    "description": "加密解密、数字签名、哈希计算、密钥生成",
    "category": "security",
    "icon": "lock",
    "tags": "[\"加密\",\"签名\",\"哈希\",\"密钥\"]",
    "config": "{\"algorithm\":\"aes-256-gcm\",\"keySize\":256}",
    "doc_path": "docs/skills/cryptography.md",
    "tools": [
      "encrypt_decrypt",
      "digital_signer",
      "key_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_time_series_analysis",
    "name": "时间序列分析",
    "display_name": "Time Series Analysis",
    "description": "时间序列数据处理、趋势分析、预测",
    "category": "data",
    "icon": "line-chart",
    "tags": "[\"时间序列\",\"预测\",\"趋势分析\",\"数据分析\"]",
    "config": "{\"interval\":\"daily\",\"window\":30}",
    "doc_path": "docs/skills/time-series-analysis.md",
    "tools": [
      "time_series_analyzer",
      "trend_detector"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_file_monitoring",
    "name": "文件监控",
    "display_name": "File Monitoring",
    "description": "监控文件系统变化、目录监听、文件变更通知",
    "category": "file",
    "icon": "eye",
    "tags": "[\"监控\",\"文件系统\",\"变更检测\",\"事件\"]",
    "config": "{\"recursive\":true,\"debounce\":500}",
    "doc_path": "docs/skills/file-monitoring.md",
    "tools": [
      "file_watcher",
      "directory_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_task_scheduling",
    "name": "任务调度",
    "display_name": "Task Scheduling",
    "description": "Cron任务调度、定时任务、周期性执行",
    "category": "automation",
    "icon": "clock",
    "tags": "[\"调度\",\"定时任务\",\"Cron\",\"自动化\"]",
    "config": "{\"timezone\":\"Asia/Shanghai\",\"maxConcurrent\":10}",
    "doc_path": "docs/skills/task-scheduling.md",
    "tools": [
      "cron_scheduler",
      "task_timer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_database_migration",
    "name": "数据库迁移",
    "display_name": "Database Migration",
    "description": "数据库版本管理、Schema迁移、数据迁移",
    "category": "database",
    "icon": "database",
    "tags": "[\"数据库\",\"迁移\",\"版本管理\",\"Schema\"]",
    "config": "{\"driver\":\"mysql\",\"migrationsPath\":\"./migrations\"}",
    "doc_path": "docs/skills/database-migration.md",
    "tools": [
      "migration_runner",
      "schema_differ"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_websocket_communication",
    "name": "WebSocket通信",
    "display_name": "WebSocket Communication",
    "description": "实时双向通信、WebSocket服务器/客户端",
    "category": "network",
    "icon": "swap",
    "tags": "[\"WebSocket\",\"实时通信\",\"双向\",\"推送\"]",
    "config": "{\"port\":8080,\"pingInterval\":30000}",
    "doc_path": "docs/skills/websocket-communication.md",
    "tools": [
      "websocket_server",
      "websocket_client"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_barcode_qrcode",
    "name": "条形码二维码",
    "display_name": "Barcode & QR Code",
    "description": "生成和识别条形码、二维码",
    "category": "image",
    "icon": "qrcode",
    "tags": "[\"二维码\",\"条形码\",\"生成\",\"识别\"]",
    "config": "{\"errorCorrectionLevel\":\"M\",\"margin\":4}",
    "doc_path": "docs/skills/barcode-qrcode.md",
    "tools": [
      "qrcode_generator",
      "barcode_generator",
      "code_recognizer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_geolocation_services",
    "name": "地理位置服务",
    "display_name": "Geolocation Services",
    "description": "地理编码、距离计算、地图服务集成",
    "category": "location",
    "icon": "environment",
    "tags": "[\"地理位置\",\"地图\",\"距离计算\",\"坐标转换\"]",
    "config": "{\"provider\":\"google\",\"units\":\"km\"}",
    "doc_path": "docs/skills/geolocation-services.md",
    "tools": [
      "geocoder",
      "distance_calculator",
      "coordinate_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_video_processing",
    "name": "视频处理",
    "display_name": "Video Processing",
    "description": "视频剪辑、转码、截图、水印添加",
    "category": "media",
    "icon": "video-camera",
    "tags": "[\"视频\",\"剪辑\",\"转码\",\"截图\"]",
    "config": "{\"codec\":\"h264\",\"quality\":\"high\"}",
    "doc_path": "docs/skills/video-processing.md",
    "tools": [
      "video_editor",
      "video_transcoder",
      "video_screenshot"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_code_analysis",
    "name": "代码分析",
    "display_name": "Code Analysis",
    "description": "代码质量检查、AST分析、复杂度计算",
    "category": "code",
    "icon": "code",
    "tags": "[\"代码分析\",\"质量检查\",\"AST\",\"复杂度\"]",
    "config": "{\"language\":\"javascript\",\"strictMode\":true}",
    "doc_path": "docs/skills/code-analysis.md",
    "tools": [
      "code_linter",
      "ast_parser",
      "complexity_calculator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // =============== 第六批技能扩展 (66-75) ===============

  {
    "id": "skill_3d_modeling",
    "name": "3D建模工具",
    "display_name": "3D Modeling",
    "description": "3D模型生成、转换、渲染、材质编辑",
    "category": "media",
    "icon": "cube",
    "tags": "[\"3D\",\"建模\",\"渲染\",\"模型转换\"]",
    "config": "{\"renderer\":\"webgl\",\"quality\":\"high\"}",
    "doc_path": "docs/skills/3d-modeling.md",
    "tools": [
      "model_generator",
      "model_converter",
      "model_renderer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_audio_analysis",
    "name": "音频分析",
    "display_name": "Audio Analysis",
    "description": "语音识别、音频指纹、声音分析、频谱分析",
    "category": "media",
    "icon": "sound",
    "tags": "[\"音频\",\"语音识别\",\"频谱分析\",\"指纹\"]",
    "config": "{\"sampleRate\":44100,\"channels\":2}",
    "doc_path": "docs/skills/audio-analysis.md",
    "tools": [
      "speech_recognizer",
      "audio_fingerprint",
      "spectrum_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_blockchain",
    "name": "区块链工具",
    "display_name": "Blockchain",
    "description": "智能合约交互、钱包管理、链上查询、交易签名",
    "category": "network",
    "icon": "link",
    "tags": "[\"区块链\",\"智能合约\",\"钱包\",\"交易\"]",
    "config": "{\"network\":\"mainnet\",\"chain\":\"ethereum\"}",
    "doc_path": "docs/skills/blockchain.md",
    "tools": [
      "contract_caller",
      "wallet_manager",
      "chain_query"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_data_visualization",
    "name": "数据可视化",
    "display_name": "Data Visualization",
    "description": "图表生成、图形绘制、仪表板创建、数据展示",
    "category": "data",
    "icon": "bar-chart",
    "tags": "[\"可视化\",\"图表\",\"仪表板\",\"绘图\"]",
    "config": "{\"chartType\":\"line\",\"theme\":\"light\"}",
    "doc_path": "docs/skills/data-visualization.md",
    "tools": [
      "chart_generator",
      "graph_plotter",
      "dashboard_creator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_iot_integration",
    "name": "IoT集成",
    "display_name": "IoT Integration",
    "description": "设备管理、MQTT通信、传感器数据处理、设备控制",
    "category": "network",
    "icon": "wifi",
    "tags": "[\"IoT\",\"设备\",\"MQTT\",\"传感器\"]",
    "config": "{\"protocol\":\"mqtt\",\"qos\":1}",
    "doc_path": "docs/skills/iot-integration.md",
    "tools": [
      "device_manager",
      "mqtt_client",
      "sensor_processor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_machine_learning",
    "name": "机器学习",
    "display_name": "Machine Learning",
    "description": "模型训练、预测、特征工程、模型评估",
    "category": "ai",
    "icon": "robot",
    "tags": "[\"机器学习\",\"训练\",\"预测\",\"特征工程\"]",
    "config": "{\"framework\":\"tensorflow\",\"backend\":\"cpu\"}",
    "doc_path": "docs/skills/machine-learning.md",
    "tools": [
      "model_trainer",
      "model_predictor",
      "feature_engineer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_natural_language",
    "name": "自然语言处理",
    "display_name": "Natural Language Processing",
    "description": "文本分类、命名实体识别、情感分析、语义分析",
    "category": "ai",
    "icon": "message",
    "tags": "[\"NLP\",\"文本分类\",\"实体识别\",\"情感分析\"]",
    "config": "{\"model\":\"bert\",\"language\":\"zh\"}",
    "doc_path": "docs/skills/natural-language.md",
    "tools": [
      "text_classifier",
      "entity_recognizer",
      "sentiment_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_performance_monitoring",
    "name": "性能监控",
    "display_name": "Performance Monitoring",
    "description": "CPU/内存监控、性能分析、基准测试、资源追踪",
    "category": "system",
    "icon": "dashboard",
    "tags": "[\"性能\",\"监控\",\"基准测试\",\"分析\"]",
    "config": "{\"interval\":1000,\"metrics\":[\"cpu\",\"memory\"]}",
    "doc_path": "docs/skills/performance-monitoring.md",
    "tools": [
      "resource_monitor",
      "performance_profiler",
      "benchmark_runner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_protocol_buffer",
    "name": "协议缓冲",
    "display_name": "Protocol Buffer",
    "description": "Protobuf编码解码、模式管理、数据序列化",
    "category": "data",
    "icon": "file-protect",
    "tags": "[\"Protobuf\",\"序列化\",\"编码\",\"模式\"]",
    "config": "{\"syntax\":\"proto3\",\"optimize\":\"speed\"}",
    "doc_path": "docs/skills/protocol-buffer.md",
    "tools": [
      "protobuf_encoder",
      "protobuf_decoder",
      "schema_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_search_engine",
    "name": "搜索引擎",
    "display_name": "Search Engine",
    "description": "全文搜索、索引构建、排序算法、搜索优化",
    "category": "data",
    "icon": "search",
    "tags": "[\"搜索\",\"索引\",\"排序\",\"全文检索\"]",
    "config": "{\"analyzer\":\"standard\",\"scoring\":\"bm25\"}",
    "doc_path": "docs/skills/search-engine.md",
    "tools": [
      "search_indexer",
      "search_query",
      "search_ranker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // =============== 第七批技能扩展 (76-85) ===============

  {
    "id": "skill_network_security",
    "name": "网络安全工具",
    "display_name": "Network Security",
    "description": "漏洞扫描、渗透测试、安全审计、加密分析",
    "category": "security",
    "icon": "safety",
    "tags": "[\"安全\",\"漏洞扫描\",\"渗透测试\",\"审计\"]",
    "config": "{\"scanDepth\":\"medium\",\"reportFormat\":\"json\"}",
    "doc_path": "docs/skills/network-security.md",
    "tools": [
      "vulnerability_scanner",
      "security_auditor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_game_engine",
    "name": "游戏引擎工具",
    "display_name": "Game Engine",
    "description": "游戏逻辑、物理引擎、碰撞检测、粒子系统",
    "category": "media",
    "icon": "rocket",
    "tags": "[\"游戏\",\"物理引擎\",\"碰撞检测\",\"粒子\"]",
    "config": "{\"physics\":\"box2d\",\"fps\":60}",
    "doc_path": "docs/skills/game-engine.md",
    "tools": [
      "physics_engine",
      "collision_detector"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_gis",
    "name": "地理信息系统",
    "display_name": "Geographic Information System",
    "description": "GIS分析、地图渲染、空间查询、路径规划",
    "category": "data",
    "icon": "environment",
    "tags": "[\"GIS\",\"地图\",\"空间分析\",\"路径规划\"]",
    "config": "{\"projection\":\"EPSG:4326\",\"tileSize\":256}",
    "doc_path": "docs/skills/gis.md",
    "tools": [
      "spatial_analyzer",
      "route_planner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_bioinformatics",
    "name": "生物信息学",
    "display_name": "Bioinformatics",
    "description": "序列分析、蛋白质结构预测、基因组分析、进化树",
    "category": "ai",
    "icon": "experiment",
    "tags": "[\"生物信息\",\"基因组\",\"蛋白质\",\"序列分析\"]",
    "config": "{\"database\":\"ncbi\",\"algorithm\":\"blast\"}",
    "doc_path": "docs/skills/bioinformatics.md",
    "tools": [
      "sequence_aligner",
      "protein_predictor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_financial_analysis",
    "name": "财务分析",
    "display_name": "Financial Analysis",
    "description": "财务建模、风险评估、投资组合优化、估值分析",
    "category": "data",
    "icon": "dollar",
    "tags": "[\"财务\",\"风险评估\",\"投资\",\"估值\"]",
    "config": "{\"currency\":\"USD\",\"riskModel\":\"var\"}",
    "doc_path": "docs/skills/financial-analysis.md",
    "tools": [
      "financial_modeler",
      "risk_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_education_assistant",
    "name": "教育辅助",
    "display_name": "Education Assistant",
    "description": "习题生成、自动批改、学习分析、知识图谱",
    "category": "ai",
    "icon": "book",
    "tags": "[\"教育\",\"习题\",\"批改\",\"学习分析\"]",
    "config": "{\"difficulty\":\"medium\",\"subject\":\"math\"}",
    "doc_path": "docs/skills/education-assistant.md",
    "tools": [
      "exercise_generator",
      "auto_grader"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_medical_health",
    "name": "医疗健康",
    "display_name": "Medical Health",
    "description": "医学影像分析、诊断辅助、健康监测、药物查询",
    "category": "ai",
    "icon": "medicine-box",
    "tags": "[\"医疗\",\"影像分析\",\"诊断\",\"健康监测\"]",
    "config": "{\"imageType\":\"ct\",\"model\":\"resnet\"}",
    "doc_path": "docs/skills/medical-health.md",
    "tools": [
      "medical_image_analyzer",
      "health_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_legal_assistant",
    "name": "法律辅助",
    "display_name": "Legal Assistant",
    "description": "法律文书生成、案例检索、合规检查、合同审查",
    "category": "ai",
    "icon": "file-protect",
    "tags": "[\"法律\",\"文书\",\"案例\",\"合规\"]",
    "config": "{\"jurisdiction\":\"cn\",\"docType\":\"contract\"}",
    "doc_path": "docs/skills/legal-assistant.md",
    "tools": [
      "legal_document_generator",
      "case_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_architecture_design",
    "name": "建筑设计",
    "display_name": "Architecture Design",
    "description": "BIM建模、结构分析、能耗计算、日照分析",
    "category": "media",
    "icon": "home",
    "tags": "[\"建筑\",\"BIM\",\"结构分析\",\"能耗\"]",
    "config": "{\"standard\":\"gb\",\"accuracy\":\"high\"}",
    "doc_path": "docs/skills/architecture-design.md",
    "tools": [
      "bim_modeler",
      "structure_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_ecommerce",
    "name": "电子商务",
    "display_name": "E-Commerce",
    "description": "推荐系统、库存管理、定价优化、用户画像",
    "category": "data",
    "icon": "shopping-cart",
    "tags": "[\"电商\",\"推荐\",\"库存\",\"定价\"]",
    "config": "{\"algorithm\":\"collaborative\",\"updateFreq\":\"hourly\"}",
    "doc_path": "docs/skills/ecommerce.md",
    "tools": [
      "recommendation_engine",
      "inventory_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // =============== 第八批技能扩展 (86-95) ===============

  {
    "id": "skill_cloud_devops",
    "name": "云计算DevOps",
    "display_name": "Cloud & DevOps",
    "description": "容器编排、CI/CD、云资源管理、自动化部署",
    "category": "system",
    "icon": "cloud",
    "tags": "[\"云计算\",\"DevOps\",\"容器\",\"CI/CD\"]",
    "config": "{\"platform\":\"kubernetes\",\"ci\":\"jenkins\"}",
    "doc_path": "docs/skills/cloud-devops.md",
    "tools": [
      "container_orchestrator",
      "cicd_pipeline"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_quantum_computing",
    "name": "量子计算",
    "display_name": "Quantum Computing",
    "description": "量子算法、量子电路设计、量子模拟、量子优化",
    "category": "ai",
    "icon": "experiment",
    "tags": "[\"量子计算\",\"量子算法\",\"量子电路\",\"优化\"]",
    "config": "{\"backend\":\"simulator\",\"qubits\":5}",
    "doc_path": "docs/skills/quantum-computing.md",
    "tools": [
      "quantum_circuit_builder",
      "quantum_simulator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_ar_vr",
    "name": "增强现实/虚拟现实",
    "display_name": "AR/VR",
    "description": "AR内容创建、VR场景构建、3D交互、空间锚点",
    "category": "media",
    "icon": "eye",
    "tags": "[\"AR\",\"VR\",\"3D\",\"交互\"]",
    "config": "{\"platform\":\"webxr\",\"tracking\":\"6dof\"}",
    "doc_path": "docs/skills/ar-vr.md",
    "tools": [
      "ar_content_creator",
      "vr_scene_builder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_speech_synthesis",
    "name": "语音合成",
    "display_name": "Speech Synthesis",
    "description": "文字转语音、语音克隆、情感语音、多语言TTS",
    "category": "media",
    "icon": "sound",
    "tags": "[\"TTS\",\"语音合成\",\"语音克隆\",\"情感\"]",
    "config": "{\"engine\":\"neural\",\"voice\":\"female\"}",
    "doc_path": "docs/skills/speech-synthesis.md",
    "tools": [
      "text_to_speech",
      "voice_cloner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_computer_vision",
    "name": "计算机视觉",
    "display_name": "Computer Vision",
    "description": "目标检测、图像分割、人脸识别、姿态估计",
    "category": "ai",
    "icon": "camera",
    "tags": "[\"视觉\",\"检测\",\"识别\",\"分割\"]",
    "config": "{\"model\":\"yolo\",\"confidence\":0.5}",
    "doc_path": "docs/skills/computer-vision.md",
    "tools": [
      "object_detector",
      "image_segmenter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_automated_testing",
    "name": "自动化测试",
    "display_name": "Automated Testing",
    "description": "单元测试、集成测试、E2E测试、性能测试",
    "category": "code",
    "icon": "check-circle",
    "tags": "[\"测试\",\"自动化\",\"质量保证\",\"CI\"]",
    "config": "{\"framework\":\"jest\",\"coverage\":80}",
    "doc_path": "docs/skills/automated-testing.md",
    "tools": [
      "test_generator",
      "test_runner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_content_management",
    "name": "内容管理系统",
    "display_name": "Content Management",
    "description": "内容发布、媒体管理、工作流审批、版本控制",
    "category": "data",
    "icon": "file-text",
    "tags": "[\"CMS\",\"内容\",\"发布\",\"媒体\"]",
    "config": "{\"storage\":\"s3\",\"cdn\":\"cloudflare\"}",
    "doc_path": "docs/skills/content-management.md",
    "tools": [
      "content_publisher",
      "media_manager"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_social_media_analytics",
    "name": "社交媒体分析",
    "display_name": "Social Media Analytics",
    "description": "舆情监控、影响力分析、话题追踪、粉丝画像",
    "category": "data",
    "icon": "team",
    "tags": "[\"社交\",\"舆情\",\"分析\",\"监控\"]",
    "config": "{\"platforms\":[\"twitter\",\"weibo\"],\"realtime\":true}",
    "doc_path": "docs/skills/social-media-analytics.md",
    "tools": [
      "sentiment_monitor",
      "influencer_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_supply_chain",
    "name": "供应链管理",
    "display_name": "Supply Chain Management",
    "description": "物流优化、供应商管理、需求预测、配送规划",
    "category": "data",
    "icon": "deployment-unit",
    "tags": "[\"供应链\",\"物流\",\"优化\",\"预测\"]",
    "config": "{\"optimization\":\"linear_programming\"}",
    "doc_path": "docs/skills/supply-chain.md",
    "tools": [
      "logistics_optimizer",
      "demand_forecaster"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_environmental_science",
    "name": "环境科学",
    "display_name": "Environmental Science",
    "description": "气象分析、环境监测、污染预测、生态建模",
    "category": "ai",
    "icon": "global",
    "tags": "[\"环境\",\"气象\",\"监测\",\"生态\"]",
    "config": "{\"dataSource\":\"weather_api\",\"resolution\":\"hourly\"}",
    "doc_path": "docs/skills/environmental-science.md",
    "tools": [
      "weather_analyzer",
      "pollution_predictor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 第九批技能 (96-105) ====================

  {
    "id": "skill_iot_platform",
    "name": "物联网平台",
    "display_name": "IoT Platform",
    "description": "设备管理、数据采集、MQTT通信、远程控制",
    "category": "system",
    "icon": "api",
    "tags": "[\"物联网\",\"IoT\",\"设备\",\"传感器\"]",
    "config": "{\"protocol\":\"mqtt\",\"broker\":\"emqx\"}",
    "doc_path": "docs/skills/iot-platform.md",
    "tools": [
      "iot_device_manager",
      "mqtt_broker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_edge_computing",
    "name": "边缘计算",
    "display_name": "Edge Computing",
    "description": "边缘节点管理、本地推理、数据预处理、低延迟计算",
    "category": "system",
    "icon": "cluster",
    "tags": "[\"边缘计算\",\"推理\",\"低延迟\",\"分布式\"]",
    "config": "{\"runtime\":\"k3s\",\"inference\":\"onnx\"}",
    "doc_path": "docs/skills/edge-computing.md",
    "tools": [
      "edge_node_manager",
      "edge_inferencer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_digital_twin",
    "name": "数字孪生",
    "display_name": "Digital Twin",
    "description": "虚拟模型构建、实时同步、仿真预测、故障诊断",
    "category": "ai",
    "icon": "fork",
    "tags": "[\"数字孪生\",\"仿真\",\"预测\",\"建模\"]",
    "config": "{\"sync_interval\":1000,\"precision\":\"high\"}",
    "doc_path": "docs/skills/digital-twin.md",
    "tools": [
      "twin_model_builder",
      "twin_simulator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_industrial_automation",
    "name": "工业自动化",
    "display_name": "Industrial Automation",
    "description": "PLC控制、SCADA系统、生产调度、质量检测",
    "category": "system",
    "icon": "control",
    "tags": "[\"工业\",\"自动化\",\"PLC\",\"SCADA\"]",
    "config": "{\"plc_type\":\"siemens\",\"protocol\":\"modbus\"}",
    "doc_path": "docs/skills/industrial-automation.md",
    "tools": [
      "plc_controller",
      "production_scheduler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_smart_home",
    "name": "智能家居",
    "display_name": "Smart Home",
    "description": "场景自动化、设备联动、能源管理、语音控制",
    "category": "system",
    "icon": "home",
    "tags": "[\"智能家居\",\"自动化\",\"IoT\",\"场景\"]",
    "config": "{\"hub\":\"homeassistant\",\"voice\":\"alexa\"}",
    "doc_path": "docs/skills/smart-home.md",
    "tools": [
      "scene_automator",
      "device_linker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_agriculture_tech",
    "name": "农业科技",
    "display_name": "Agriculture Technology",
    "description": "精准农业、作物监测、灌溉控制、病虫害预测",
    "category": "ai",
    "icon": "fire",
    "tags": "[\"农业\",\"精准农业\",\"监测\",\"预测\"]",
    "config": "{\"sensors\":[\"soil\",\"weather\"],\"ai\":true}",
    "doc_path": "docs/skills/agriculture-tech.md",
    "tools": [
      "crop_monitor",
      "irrigation_controller"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_smart_city",
    "name": "智慧城市",
    "display_name": "Smart City",
    "description": "交通管理、公共安全、能源优化、垃圾分类",
    "category": "system",
    "icon": "bank",
    "tags": "[\"智慧城市\",\"交通\",\"安全\",\"能源\"]",
    "config": "{\"modules\":[\"traffic\",\"energy\",\"safety\"]}",
    "doc_path": "docs/skills/smart-city.md",
    "tools": [
      "traffic_controller",
      "public_safety_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_aerospace",
    "name": "航空航天",
    "display_name": "Aerospace Engineering",
    "description": "轨道计算、飞行规划、卫星通信、航迹优化",
    "category": "data",
    "icon": "rocket",
    "tags": "[\"航空\",\"航天\",\"轨道\",\"卫星\"]",
    "config": "{\"precision\":\"double\",\"units\":\"metric\"}",
    "doc_path": "docs/skills/aerospace.md",
    "tools": [
      "orbit_calculator",
      "flight_planner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_ocean_science",
    "name": "海洋科学",
    "display_name": "Ocean Science",
    "description": "海洋监测、航海路径规划、海洋生态、气候分析",
    "category": "ai",
    "icon": "cloud",
    "tags": "[\"海洋\",\"航海\",\"生态\",\"监测\"]",
    "config": "{\"data_source\":\"satellite\",\"resolution\":\"1km\"}",
    "doc_path": "docs/skills/ocean-science.md",
    "tools": [
      "ocean_monitor",
      "navigation_planner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_energy_management",
    "name": "能源管理",
    "display_name": "Energy Management",
    "description": "电力调度、新能源预测、储能优化、碳排放管理",
    "category": "data",
    "icon": "thunderbolt",
    "tags": "[\"能源\",\"电力\",\"新能源\",\"碳排放\"]",
    "config": "{\"grid_type\":\"smart\",\"renewables\":true}",
    "doc_path": "docs/skills/energy-management.md",
    "tools": [
      "power_dispatcher",
      "renewable_forecaster"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 第十批技能 (106-115) ====================

  {
    "id": "skill_quantum_communication",
    "name": "量子通信",
    "display_name": "Quantum Communication",
    "description": "量子密钥分发、量子隐形传态、量子纠缠、量子中继",
    "category": "ai",
    "icon": "link",
    "tags": "[\"量子\",\"通信\",\"加密\",\"安全\"]",
    "config": "{\"protocol\":\"BB84\",\"security_level\":\"unconditional\"}",
    "doc_path": "docs/skills/quantum-communication.md",
    "tools": [
      "quantum_key_distributor",
      "quantum_teleporter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_brain_computer_interface",
    "name": "脑机接口",
    "display_name": "Brain-Computer Interface",
    "description": "脑电信号处理、意图识别、神经反馈、康复训练",
    "category": "ai",
    "icon": "radar-chart",
    "tags": "[\"BCI\",\"脑电\",\"神经\",\"康复\"]",
    "config": "{\"channels\":64,\"sampling_rate\":1000,\"signal_type\":\"EEG\"}",
    "doc_path": "docs/skills/brain-computer-interface.md",
    "tools": [
      "eeg_processor",
      "bci_decoder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_synthetic_biology",
    "name": "合成生物学",
    "display_name": "Synthetic Biology",
    "description": "基因编辑、代谢工程、蛋白质设计、合成基因回路",
    "category": "ai",
    "icon": "experiment",
    "tags": "[\"基因\",\"合成生物\",\"CRISPR\",\"蛋白质\"]",
    "config": "{\"editor\":\"CRISPR-Cas9\",\"organism\":\"E.coli\"}",
    "doc_path": "docs/skills/synthetic-biology.md",
    "tools": [
      "gene_editor",
      "protein_designer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_nanotechnology",
    "name": "纳米技术",
    "display_name": "Nanotechnology",
    "description": "纳米材料模拟、纳米加工、纳米传感、分子动力学",
    "category": "ai",
    "icon": "dot-chart",
    "tags": "[\"纳米\",\"材料\",\"模拟\",\"加工\"]",
    "config": "{\"scale\":\"nanometer\",\"method\":\"molecular_dynamics\"}",
    "doc_path": "docs/skills/nanotechnology.md",
    "tools": [
      "nano_simulator",
      "nano_fabricator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_nuclear_technology",
    "name": "核能技术",
    "display_name": "Nuclear Technology",
    "description": "反应堆模拟、辐射监测、核燃料管理、核安全评估",
    "category": "system",
    "icon": "alert",
    "tags": "[\"核能\",\"反应堆\",\"辐射\",\"安全\"]",
    "config": "{\"reactor_type\":\"PWR\",\"safety_level\":\"high\"}",
    "doc_path": "docs/skills/nuclear-technology.md",
    "tools": [
      "reactor_simulator",
      "radiation_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_deep_sea_exploration",
    "name": "深海探测",
    "display_name": "Deep Sea Exploration",
    "description": "水下导航、深海测绘、ROV控制、海底资源勘探",
    "category": "data",
    "icon": "compass",
    "tags": "[\"深海\",\"探测\",\"ROV\",\"测绘\"]",
    "config": "{\"max_depth\":11000,\"navigation\":\"INS+DVL\"}",
    "doc_path": "docs/skills/deep-sea-exploration.md",
    "tools": [
      "underwater_navigator",
      "deep_sea_mapper"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_space_resources",
    "name": "太空资源",
    "display_name": "Space Resources",
    "description": "小行星分析、月球采矿、太空制造、资源评估",
    "category": "data",
    "icon": "gold",
    "tags": "[\"太空\",\"采矿\",\"资源\",\"小行星\"]",
    "config": "{\"target\":\"asteroid\",\"method\":\"in-situ\"}",
    "doc_path": "docs/skills/space-resources.md",
    "tools": [
      "asteroid_analyzer",
      "lunar_miner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_weather_modification",
    "name": "气象控制",
    "display_name": "Weather Modification",
    "description": "人工降雨、云播种、气候干预、天气建模",
    "category": "ai",
    "icon": "cloud-sync",
    "tags": "[\"气象\",\"人工降雨\",\"气候\",\"建模\"]",
    "config": "{\"method\":\"cloud_seeding\",\"agent\":\"silver_iodide\"}",
    "doc_path": "docs/skills/weather-modification.md",
    "tools": [
      "cloud_seeder",
      "weather_modeler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_materials_science",
    "name": "材料科学",
    "display_name": "Materials Science",
    "description": "材料设计、性能预测、晶体结构、材料筛选",
    "category": "ai",
    "icon": "build",
    "tags": "[\"材料\",\"设计\",\"预测\",\"晶体\"]",
    "config": "{\"method\":\"DFT\",\"database\":\"Materials_Project\"}",
    "doc_path": "docs/skills/materials-science.md",
    "tools": [
      "material_designer",
      "property_predictor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_neuromorphic_computing",
    "name": "神经形态计算",
    "display_name": "Neuromorphic Computing",
    "description": "脉冲神经网络、神经形态芯片、类脑计算、事件驱动计算",
    "category": "ai",
    "icon": "deployment-unit",
    "tags": "[\"神经形态\",\"SNN\",\"类脑\",\"芯片\"]",
    "config": "{\"architecture\":\"spiking\",\"hardware\":\"Loihi\"}",
    "doc_path": "docs/skills/neuromorphic-computing.md",
    "tools": [
      "snn_builder",
      "neuromorphic_accelerator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ========== 第十一批技能 (116-125): 前沿物理与尖端科学 ==========

  {
    "id": "skill_gravitational_wave_detection",
    "name": "引力波探测",
    "display_name": "Gravitational Wave Detection",
    "description": "LIGO/Virgo数据分析、引力波信号处理、黑洞碰撞模拟、中子星合并",
    "category": "science",
    "icon": "radar-chart",
    "tags": "[\"引力波\",\"LIGO\",\"天文\",\"物理\"]",
    "config": "{\"detector\":\"LIGO\",\"sensitivity\":\"advanced\"}",
    "doc_path": "docs/skills/gravitational-wave-detection.md",
    "tools": [
      "ligo_data_analyzer",
      "waveform_matcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_particle_physics",
    "name": "粒子物理",
    "display_name": "Particle Physics",
    "description": "高能物理模拟、粒子碰撞分析、标准模型计算、新粒子搜寻",
    "category": "science",
    "icon": "experiment",
    "tags": "[\"粒子\",\"高能\",\"LHC\",\"量子场论\"]",
    "config": "{\"collider\":\"LHC\",\"energy\":\"13TeV\"}",
    "doc_path": "docs/skills/particle-physics.md",
    "tools": [
      "particle_simulator",
      "event_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_dark_matter_detection",
    "name": "暗物质探测",
    "display_name": "Dark Matter Detection",
    "description": "WIMP探测、轴子搜寻、直接探测实验、间接探测分析",
    "category": "science",
    "icon": "search",
    "tags": "[\"暗物质\",\"WIMP\",\"轴子\",\"探测器\"]",
    "config": "{\"method\":\"direct\",\"target\":\"WIMP\"}",
    "doc_path": "docs/skills/dark-matter-detection.md",
    "tools": [
      "wimp_detector",
      "axion_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_controlled_fusion",
    "name": "可控核聚变",
    "display_name": "Controlled Nuclear Fusion",
    "description": "托卡马克模拟、磁约束聚变、惯性约束聚变、等离子体控制",
    "category": "energy",
    "icon": "thunderbolt",
    "tags": "[\"核聚变\",\"托卡马克\",\"等离子体\",\"ITER\"]",
    "config": "{\"device\":\"tokamak\",\"confinement\":\"magnetic\"}",
    "doc_path": "docs/skills/controlled-fusion.md",
    "tools": [
      "tokamak_simulator",
      "plasma_controller"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_photonic_computing",
    "name": "光子计算",
    "display_name": "Photonic Computing",
    "description": "全光网络、光子芯片设计、光学神经网络、光子存储",
    "category": "ai",
    "icon": "highlight",
    "tags": "[\"光子\",\"光学\",\"光计算\",\"芯片\"]",
    "config": "{\"wavelength\":\"1550nm\",\"modulation\":\"phase\"}",
    "doc_path": "docs/skills/photonic-computing.md",
    "tools": [
      "photonic_router",
      "optical_nn_designer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_topological_quantum",
    "name": "拓扑量子",
    "display_name": "Topological Quantum",
    "description": "拓扑绝缘体、马约拉纳费米子、拓扑量子计算、量子霍尔效应",
    "category": "ai",
    "icon": "gateway",
    "tags": "[\"拓扑\",\"量子\",\"马约拉纳\",\"拓扑序\"]",
    "config": "{\"dimension\":\"2D\",\"phase\":\"topological\"}",
    "doc_path": "docs/skills/topological-quantum.md",
    "tools": [
      "topological_state_calculator",
      "majorana_detector"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_polar_science",
    "name": "极地科学",
    "display_name": "Polar Science",
    "description": "南北极考察、冰芯分析、气候重建、极地生态研究",
    "category": "science",
    "icon": "heat-map",
    "tags": "[\"极地\",\"冰芯\",\"气候\",\"南极\"]",
    "config": "{\"region\":\"Antarctica\",\"depth\":\"3000m\"}",
    "doc_path": "docs/skills/polar-science.md",
    "tools": [
      "ice_core_analyzer",
      "climate_reconstructor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_volcanology",
    "name": "火山学",
    "display_name": "Volcanology",
    "description": "岩浆模拟、火山监测、喷发预警、地球化学分析",
    "category": "science",
    "icon": "fire",
    "tags": "[\"火山\",\"岩浆\",\"预警\",\"地质\"]",
    "config": "{\"monitoring\":\"real-time\",\"alert_level\":\"normal\"}",
    "doc_path": "docs/skills/volcanology.md",
    "tools": [
      "magma_simulator",
      "volcanic_monitor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_archaeological_technology",
    "name": "考古科技",
    "display_name": "Archaeological Technology",
    "description": "碳14测年、3D重建、文物保护、遗址勘探",
    "category": "science",
    "icon": "bank",
    "tags": "[\"考古\",\"碳14\",\"3D重建\",\"文物\"]",
    "config": "{\"method\":\"radiocarbon\",\"calibration\":\"IntCal20\"}",
    "doc_path": "docs/skills/archaeological-technology.md",
    "tools": [
      "radiocarbon_dater",
      "artifact_reconstructor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_bioelectronics",
    "name": "生物电子学",
    "display_name": "Bioelectronics",
    "description": "有机电子、柔性传感器、生物芯片、可穿戴设备",
    "category": "hardware",
    "icon": "heart",
    "tags": "[\"生物电子\",\"柔性\",\"传感器\",\"可穿戴\"]",
    "config": "{\"material\":\"organic\",\"flexibility\":\"high\"}",
    "doc_path": "docs/skills/bioelectronics.md",
    "tools": [
      "flexible_sensor_designer",
      "biochip_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ========== 第十二批技能 (126-135): 日常实用工具 ==========

  {
    "id": "skill_file_compression",
    "name": "文件压缩",
    "display_name": "File Compression",
    "description": "ZIP/RAR/7Z压缩、解压、加密压缩包、批量压缩",
    "category": "file",
    "icon": "file-zip",
    "tags": "[\"压缩\",\"解压\",\"ZIP\",\"RAR\"]",
    "config": "{\"default_format\":\"zip\",\"compression_level\":\"standard\"}",
    "doc_path": "docs/skills/file-compression.md",
    "tools": [
      "file_compressor",
      "file_decompressor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_image_editing",
    "name": "图片编辑",
    "display_name": "Image Editing",
    "description": "图片裁剪、缩放、旋转、滤镜、水印、格式转换",
    "category": "media",
    "icon": "picture",
    "tags": "[\"图片\",\"编辑\",\"滤镜\",\"水印\"]",
    "config": "{\"output_quality\":\"high\",\"preserve_metadata\":true}",
    "doc_path": "docs/skills/image-editing.md",
    "tools": [
      "image_editor",
      "image_filter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_video_editing",
    "name": "视频编辑",
    "display_name": "Video Editing",
    "description": "视频剪辑、合并、转码、添加字幕、提取音频",
    "category": "media",
    "icon": "video-camera",
    "tags": "[\"视频\",\"剪辑\",\"转码\",\"字幕\"]",
    "config": "{\"output_format\":\"mp4\",\"codec\":\"h264\"}",
    "doc_path": "docs/skills/video-editing.md",
    "tools": [
      "video_cutter",
      "video_merger"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_document_conversion",
    "name": "文档转换",
    "display_name": "Document Conversion",
    "description": "PDF/Word/Excel互转、Markdown转换、批量转换",
    "category": "document",
    "icon": "file-text",
    "tags": "[\"PDF\",\"Word\",\"转换\",\"文档\"]",
    "config": "{\"preserve_layout\":true,\"ocr_enabled\":false}",
    "doc_path": "docs/skills/document-conversion.md",
    "tools": [
      "pdf_converter",
      "office_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_qrcode_tools",
    "name": "二维码工具",
    "display_name": "QR Code Tools",
    "description": "二维码生成、扫描识别、批量生成、自定义样式",
    "category": "utility",
    "icon": "qrcode",
    "tags": "[\"二维码\",\"条形码\",\"生成\",\"识别\"]",
    "config": "{\"default_size\":256,\"error_correction\":\"M\"}",
    "doc_path": "docs/skills/qrcode-tools.md",
    "tools": [
      "qrcode_generator_advanced",
      "qrcode_scanner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_screen_capture",
    "name": "截图录屏",
    "display_name": "Screen Capture",
    "description": "屏幕截图、录屏、GIF录制、截图标注",
    "category": "media",
    "icon": "camera",
    "tags": "[\"截图\",\"录屏\",\"GIF\",\"标注\"]",
    "config": "{\"capture_cursor\":true,\"audio_enabled\":true}",
    "doc_path": "docs/skills/screen-capture.md",
    "tools": [
      "screenshot_tool",
      "screen_recorder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_calendar_schedule",
    "name": "日程管理",
    "display_name": "Calendar & Schedule",
    "description": "日历管理、事件提醒、待办事项、日程安排",
    "category": "productivity",
    "icon": "calendar",
    "tags": "[\"日历\",\"日程\",\"提醒\",\"待办\"]",
    "config": "{\"default_view\":\"month\",\"reminder_minutes\":15}",
    "doc_path": "docs/skills/calendar-schedule.md",
    "tools": [
      "calendar_manager",
      "reminder_scheduler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_note_management",
    "name": "笔记管理",
    "display_name": "Note Management",
    "description": "Markdown笔记、富文本编辑、笔记搜索、标签分类",
    "category": "document",
    "icon": "book",
    "tags": "[\"笔记\",\"Markdown\",\"搜索\",\"标签\"]",
    "config": "{\"auto_save\":true,\"sync_enabled\":false}",
    "doc_path": "docs/skills/note-management.md",
    "tools": [
      "note_editor",
      "note_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_password_manager",
    "name": "密码管理",
    "display_name": "Password Manager",
    "description": "密码生成、安全存储、密码强度检测、自动填充",
    "category": "security",
    "icon": "lock",
    "tags": "[\"密码\",\"安全\",\"加密\",\"管理\"]",
    "config": "{\"encryption\":\"AES-256\",\"master_password_required\":true}",
    "doc_path": "docs/skills/password-manager.md",
    "tools": [
      "password_generator_advanced",
      "password_vault"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  {
    "id": "skill_network_diagnostics",
    "name": "网络诊断",
    "display_name": "Network Diagnostics",
    "description": "网速测试、Ping测试、端口扫描、DNS查询、路由追踪",
    "category": "network",
    "icon": "global",
    "tags": "[\"网络\",\"测速\",\"Ping\",\"诊断\"]",
    "config": "{\"timeout\":5000,\"max_hops\":30}",
    "doc_path": "docs/skills/network-diagnostics.md",
    "tools": [
      "network_speed_tester",
      "network_diagnostic_tool"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

// 合并所有技能（内置技能 + 额外技能）
module.exports = [
  ...builtinSkills,
  ...additionalSkills
];
