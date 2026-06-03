/**
 * 额外技能定义（第二批）
 * 10个新增的高价值技能
 */

const additionalSkillsV2 = [
  // 1. 社交媒体管理技能
  {
    "id": "skill_social_media_management",
    "name": "社交媒体管理",
    "display_name": "Social Media Management",
    "description": "全平台社交媒体内容策划、发布和数据分析",
    "category": "marketing",
    "icon": "share-alt",
    "tags": "[\"社交媒体\",\"内容营销\",\"数据分析\"]",
    "config": "{\"platforms\":[\"微博\",\"微信\",\"抖音\",\"小红书\"],\"analytics\":true}",
    "doc_path": "docs/skills/social-media-management.md",
    "tools": [
      "content_calendar_generator",
      "social_media_post_creator",
      "hashtag_generator",
      "analytics_reporter",
      "image_optimizer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 2. SEO优化技能
  {
    "id": "skill_seo_optimization",
    "name": "SEO优化",
    "display_name": "SEO Optimization",
    "description": "搜索引擎优化，包含关键词研究、内容优化和技术SEO",
    "category": "marketing",
    "icon": "search",
    "tags": "[\"SEO\",\"关键词\",\"排名优化\"]",
    "config": "{\"searchEngines\":[\"百度\",\"Google\"],\"autoAnalysis\":true}",
    "doc_path": "docs/skills/seo-optimization.md",
    "tools": [
      "keyword_research_tool",
      "seo_analyzer",
      "meta_tag_generator",
      "sitemap_generator",
      "backlink_checker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 3. 视频编辑技能
  {
    "id": "skill_video_editing",
    "name": "视频编辑",
    "display_name": "Video Editing",
    "description": "视频剪辑、字幕添加、特效制作和视频压缩",
    "category": "media",
    "icon": "video",
    "tags": "[\"视频\",\"剪辑\",\"后期制作\"]",
    "config": "{\"maxResolution\":\"4K\",\"supportedFormats\":[\"mp4\",\"mov\",\"avi\"]}",
    "doc_path": "docs/skills/video-editing.md",
    "tools": [
      "video_trimmer",
      "subtitle_generator",
      "video_compressor",
      "video_converter",
      "thumbnail_creator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 4. 音频处理技能
  {
    "id": "skill_audio_editing",
    "name": "音频处理",
    "display_name": "Audio Editing",
    "description": "音频录制、编辑、降噪和格式转换",
    "category": "media",
    "icon": "sound",
    "tags": "[\"音频\",\"播客\",\"音乐制作\"]",
    "config": "{\"sampleRate\":48000,\"bitDepth\":24}",
    "doc_path": "docs/skills/audio-editing.md",
    "tools": [
      "audio_recorder",
      "audio_editor",
      "noise_reducer",
      "audio_converter",
      "voice_enhancer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 5. UI/UX设计技能
  {
    "id": "skill_ui_ux_design",
    "name": "UI/UX设计",
    "display_name": "UI/UX Design",
    "description": "用户界面设计、用户体验优化和原型设计",
    "category": "design",
    "icon": "layout",
    "tags": "[\"UI\",\"UX\",\"界面设计\",\"原型\"]",
    "config": "{\"designSystem\":\"Material Design\",\"responsive\":true}",
    "doc_path": "docs/skills/ui-ux-design.md",
    "tools": [
      "wireframe_generator",
      "mockup_creator",
      "color_palette_generator",
      "icon_designer",
      "prototype_builder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 6. 财务分析技能
  {
    "id": "skill_financial_analysis",
    "name": "财务分析",
    "display_name": "Financial Analysis",
    "description": "财务报表分析、预算管理和投资决策支持",
    "category": "finance",
    "icon": "dollar",
    "tags": "[\"财务\",\"分析\",\"预算\",\"投资\"]",
    "config": "{\"currency\":\"CNY\",\"fiscalYear\":\"calendar\"}",
    "doc_path": "docs/skills/financial-analysis.md",
    "tools": [
      "budget_planner",
      "financial_calculator",
      "roi_analyzer",
      "cash_flow_projector",
      "expense_tracker"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 7. 项目管理技能
  {
    "id": "skill_project_management",
    "name": "项目管理",
    "display_name": "Project Management",
    "description": "项目规划、任务分配、进度跟踪和风险管理",
    "category": "productivity",
    "icon": "project",
    "tags": "[\"项目管理\",\"任务\",\"协作\"]",
    "config": "{\"methodology\":\"Agile\",\"sprintDuration\":14}",
    "doc_path": "docs/skills/project-management.md",
    "tools": [
      "gantt_chart_generator",
      "task_manager",
      "timeline_creator",
      "resource_allocator",
      "risk_matrix_builder"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 8. 机器学习技能
  {
    "id": "skill_machine_learning",
    "name": "机器学习",
    "display_name": "Machine Learning",
    "description": "数据预处理、模型训练、预测分析和模型评估",
    "category": "ai",
    "icon": "robot",
    "tags": "[\"机器学习\",\"AI\",\"预测\",\"模型\"]",
    "config": "{\"frameworks\":[\"TensorFlow\",\"PyTorch\"],\"autoML\":true}",
    "doc_path": "docs/skills/machine-learning.md",
    "tools": [
      "data_preprocessor",
      "feature_engineer",
      "model_trainer",
      "prediction_engine",
      "model_evaluator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 9. 数据可视化技能
  {
    "id": "skill_data_visualization",
    "name": "数据可视化",
    "display_name": "Data Visualization",
    "description": "数据图表生成、仪表盘设计和交互式可视化",
    "category": "data",
    "icon": "bar-chart",
    "tags": "[\"数据可视化\",\"图表\",\"仪表盘\"]",
    "config": "{\"chartLibrary\":\"ECharts\",\"responsive\":true}",
    "doc_path": "docs/skills/data-visualization.md",
    "tools": [
      "chart_generator",
      "dashboard_builder",
      "heatmap_creator",
      "treemap_generator",
      "interactive_viz_tool"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // 10. 品牌设计技能
  {
    "id": "skill_brand_design",
    "name": "品牌设计",
    "display_name": "Brand Design",
    "description": "Logo设计、VI系统、品牌手册和视觉识别",
    "category": "design",
    "icon": "crown",
    "tags": "[\"品牌\",\"Logo\",\"VI\",\"视觉识别\"]",
    "config": "{\"designStyle\":\"modern\",\"colorTheory\":true}",
    "doc_path": "docs/skills/brand-design.md",
    "tools": [
      "logo_generator",
      "color_scheme_creator",
      "font_pairing_tool",
      "brand_guideline_generator",
      "mockup_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = additionalSkillsV2;
