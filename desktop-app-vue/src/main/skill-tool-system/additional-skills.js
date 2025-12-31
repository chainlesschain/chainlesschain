/**
 * 补充技能定义
 * 添加Office套件、数据科学等专业领域技能
 *
 * 使用方法：将这些技能定义合并到 builtin-skills.js 的 module.exports 数组中
 */

const additionalSkills = [
  // ==================== Office 套件技能 ====================

  {
    "id": "skill_office_suite",
    "name": "Office套件操作",
    "display_name": "Office Suite",
    "description": "Word、Excel、PPT文档的创建、编辑、格式化和自动化处理",
    "category": "office",
    "icon": "file-excel",
    "tags": "[\"Office\",\"Word\",\"Excel\",\"PPT\",\"文档\"]",
    "config": "{\"defaultFormat\":\"modern\",\"autoSave\":true}",
    "doc_path": "docs/skills/office-suite.md",
    "tools": [
      "tool_word_generator",
      "tool_word_table_creator",
      "tool_excel_generator",
      "tool_excel_formula_builder",
      "tool_excel_chart_creator",
      "tool_ppt_generator",
      "tool_ppt_slide_creator",
      "tool_ppt_theme_applicator",
      "tool_pdf_generator",
      "tool_pdf_converter",
      "tool_office_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 数据科学技能 ====================

  {
    "id": "skill_data_science",
    "name": "数据科学分析",
    "display_name": "Data Science",
    "description": "数据预处理、特征工程、机器学习建模、模型评估和可视化分析",
    "category": "data",
    "icon": "experiment",
    "tags": "[\"数据科学\",\"机器学习\",\"统计分析\",\"数据挖掘\"]",
    "config": "{\"defaultFramework\":\"scikit-learn\",\"autoEDA\":true}",
    "doc_path": "docs/skills/data-science.md",
    "tools": [
      "tool_data_preprocessor",
      "tool_feature_engineer",
      "tool_ml_model_trainer",
      "tool_model_evaluator",
      "tool_chart_generator",
      "tool_statistical_analyzer",
      "tool_eda_generator",
      "tool_excel_reader",
      "tool_csv_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== SEO与数字营销技能 ====================

  {
    "id": "skill_seo_marketing",
    "name": "SEO与数字营销",
    "display_name": "SEO & Digital Marketing",
    "description": "搜索引擎优化、关键词研究、内容优化、营销文案撰写",
    "category": "marketing",
    "icon": "rise",
    "tags": "[\"SEO\",\"营销\",\"内容优化\",\"关键词\"]",
    "config": "{\"language\":\"zh-CN\",\"focusKeywords\":5}",
    "doc_path": "docs/skills/seo-marketing.md",
    "tools": [
      "tool_seo_optimizer",
      "tool_keyword_extractor",
      "tool_readability_checker",
      "tool_text_analyzer",
      "tool_file_writer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 视频制作技能 ====================

  {
    "id": "skill_video_production",
    "name": "视频制作",
    "display_name": "Video Production",
    "description": "视频剪辑、合并、字幕添加、特效处理",
    "category": "media",
    "icon": "video-camera",
    "tags": "[\"视频\",\"剪辑\",\"制作\",\"后期\"]",
    "config": "{\"defaultFormat\":\"mp4\",\"quality\":\"1080p\"}",
    "doc_path": "docs/skills/video-production.md",
    "tools": [
      "tool_video_cutter",
      "tool_video_merger",
      "tool_video_editor",
      "tool_subtitle_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 音频编辑技能 ====================

  {
    "id": "skill_audio_editing",
    "name": "音频编辑",
    "display_name": "Audio Editing",
    "description": "音频剪辑、降噪、混音、格式转换",
    "category": "media",
    "icon": "audio",
    "tags": "[\"音频\",\"剪辑\",\"降噪\",\"混音\"]",
    "config": "{\"defaultFormat\":\"mp3\",\"bitrate\":\"320k\"}",
    "doc_path": "docs/skills/audio-editing.md",
    "tools": [
      "tool_audio_cutter",
      "tool_audio_merger",
      "tool_audio_noise_reduction",
      "tool_audio_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 数据库管理技能 ====================

  {
    "id": "skill_database_management",
    "name": "数据库管理",
    "display_name": "Database Management",
    "description": "SQL查询、数据库设计、数据迁移、备份恢复",
    "category": "database",
    "icon": "database",
    "tags": "[\"数据库\",\"SQL\",\"MySQL\",\"PostgreSQL\"]",
    "config": "{\"defaultDB\":\"postgresql\"}",
    "doc_path": "docs/skills/database-management.md",
    "tools": [
      "tool_sql_builder",
      "tool_sql_executor",
      "tool_db_schema_generator",
      "tool_db_migration_tool"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== API开发技能 ====================

  {
    "id": "skill_api_development",
    "name": "API开发",
    "display_name": "API Development",
    "description": "RESTful API设计、OpenAPI文档生成、API测试",
    "category": "backend",
    "icon": "api",
    "tags": "[\"API\",\"REST\",\"GraphQL\",\"Swagger\"]",
    "config": "{\"defaultVersion\":\"v1\",\"authType\":\"jwt\"}",
    "doc_path": "docs/skills/api-development.md",
    "tools": [
      "tool_api_schema_generator",
      "tool_openapi_doc_generator",
      "tool_http_client",
      "tool_api_tester"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== UI/UX设计技能 ====================

  {
    "id": "skill_ui_ux_design",
    "name": "UI/UX设计",
    "display_name": "UI/UX Design",
    "description": "界面设计、原型制作、用户体验优化",
    "category": "design",
    "icon": "bg-colors",
    "tags": "[\"UI\",\"UX\",\"设计\",\"原型\"]",
    "config": "{\"designSystem\":\"modern\"}",
    "doc_path": "docs/skills/ui-ux-design.md",
    "tools": [
      "tool_color_palette_generator",
      "tool_typography_selector",
      "tool_image_editor",
      "tool_svg_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== 测试与质量保证技能 ====================

  {
    "id": "skill_testing_qa",
    "name": "测试与质量保证",
    "display_name": "Testing & QA",
    "description": "单元测试、集成测试、E2E测试、代码质量检查",
    "category": "quality",
    "icon": "check-circle",
    "tags": "[\"测试\",\"QA\",\"质量保证\"]",
    "config": "{\"testFramework\":\"jest\"}",
    "doc_path": "docs/skills/testing-qa.md",
    "tools": [
      "tool_test_generator",
      "tool_test_runner",
      "tool_code_coverage_analyzer",
      "tool_code_quality_checker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ==================== DevOps与CI/CD技能 ====================

  {
    "id": "skill_devops_cicd",
    "name": "DevOps与CI/CD",
    "display_name": "DevOps & CI/CD",
    "description": "持续集成、持续部署、容器化、自动化运维",
    "category": "devops",
    "icon": "deployment-unit",
    "tags": "[\"DevOps\",\"CI/CD\",\"Docker\",\"Kubernetes\"]",
    "config": "{\"ciTool\":\"github-actions\"}",
    "doc_path": "docs/skills/devops-cicd.md",
    "tools": [
      "tool_dockerfile_generator",
      "tool_docker_compose_generator",
      "tool_ci_config_generator",
      "tool_deployment_script_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = additionalSkills;
