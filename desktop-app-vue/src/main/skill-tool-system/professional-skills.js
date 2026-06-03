/**
 * 职业专用技能定义
 * 为医生、律师、教师、研究员提供专业技能
 *
 * 创建日期: 2026-01-07
 * 版本: v1.0
 */

const professionalSkills = [
  // ================================
  // 医疗职业技能 (Medical Skills)
  // ================================
  {
    "id": "skill_medical_diagnosis",
    "name": "医学诊断辅助",
    "display_name": "Medical Diagnosis Support",
    "description": "提供全面的医学诊断辅助能力，包括ICD编码查询、生命体征监测、检验结果解读等",
    "category": "medical",
    "icon": "medicine-box",
    "tags": `["医学","诊断","临床"]`,
    "config": `{"autoSaveRecords":true,"alertThreshold":"moderate"}`,
    "doc_path": "docs/skills/medical-diagnosis.md",
    "tools": [
      "icd_lookup",
      "vital_signs_monitor",
      "lab_result_interpreter",
      "medical_calculator",
      "text_analyzer",
      "file_reader",
      "file_writer",
      "note_editor",
      "note_searcher",
      "info_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_medication_management",
    "name": "用药管理",
    "display_name": "Medication Management",
    "description": "药物相互作用检查、用药剂量计算、用药安全监测",
    "category": "medical",
    "icon": "experiment",
    "tags": `["用药","药物","安全"]`,
    "config": `{"enableInteractionCheck":true,"enableDosageCalculation":true}`,
    "doc_path": "docs/skills/medication-management.md",
    "tools": [
      "drug_interaction_check",
      "medical_calculator",
      "info_searcher",
      "file_reader",
      "file_writer",
      "note_editor",
      "datetime_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_medical_documentation",
    "name": "医疗文档管理",
    "display_name": "Medical Documentation",
    "description": "病历记录、医疗报告生成、医学文献管理",
    "category": "medical",
    "icon": "file-text",
    "tags": `["病历","文档","记录"]`,
    "config": `{"autoBackup":true,"encryptionEnabled":true}`,
    "doc_path": "docs/skills/medical-documentation.md",
    "tools": [
      "file_reader",
      "file_writer",
      "file_editor",
      "note_editor",
      "note_searcher",
      "markdown_converter",
      "pdf_text_extractor",
      "pdf_merger",
      "template_renderer",
      "datetime_handler",
      "file_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_clinical_research",
    "name": "临床研究支持",
    "display_name": "Clinical Research Support",
    "description": "医学文献检索、临床数据分析、研究文档管理",
    "category": "medical",
    "icon": "experiment",
    "tags": `["临床研究","数据分析","文献"]`,
    "config": `{"citationStyle":"vancouver","dataValidation":true}`,
    "doc_path": "docs/skills/clinical-research.md",
    "tools": [
      "lab_result_interpreter",
      "medical_calculator",
      "info_searcher",
      "file_reader",
      "data_aggregator",
      "statistical_calculator",
      "chart_data_generator",
      "text_analyzer",
      "json_parser",
      "markdown_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ================================
  // 法律职业技能 (Legal Skills)
  // ================================
  {
    "id": "skill_legal_research",
    "name": "法律研究",
    "display_name": "Legal Research",
    "description": "法律法规检索、判例检索、法律文献研究",
    "category": "legal",
    "icon": "search",
    "tags": `["法律","检索","研究"]`,
    "config": `{"defaultDatabase":"national","cacheResults":true}`,
    "doc_path": "docs/skills/legal-research.md",
    "tools": [
      "legal_database_search",
      "case_precedent_search",
      "info_searcher",
      "file_reader",
      "file_writer",
      "text_analyzer",
      "note_editor",
      "note_searcher",
      "markdown_converter",
      "diff_comparator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_legal_drafting",
    "name": "法律文书起草",
    "display_name": "Legal Drafting",
    "description": "合同起草、法律意见书撰写、诉讼文书准备",
    "category": "legal",
    "icon": "edit",
    "tags": `["合同","文书","起草"]`,
    "config": `{"autoSave":true,"versionControl":true}`,
    "doc_path": "docs/skills/legal-drafting.md",
    "tools": [
      "statute_citation",
      "contract_clause_library",
      "file_reader",
      "file_writer",
      "file_editor",
      "template_renderer",
      "markdown_converter",
      "diff_comparator",
      "note_editor",
      "datetime_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_case_management",
    "name": "案件管理",
    "display_name": "Case Management",
    "description": "案件信息管理、诉讼期限提醒、证据材料整理",
    "category": "legal",
    "icon": "folder-open",
    "tags": `["案件","管理","期限"]`,
    "config": `{"enableReminders":true,"autoCalculateDeadlines":true}`,
    "doc_path": "docs/skills/case-management.md",
    "tools": [
      "litigation_deadline_calculator",
      "case_precedent_search",
      "file_reader",
      "file_writer",
      "file_searcher",
      "note_editor",
      "note_searcher",
      "datetime_handler",
      "cron_parser",
      "zip_handler",
      "file_compressor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_contract_review",
    "name": "合同审查",
    "display_name": "Contract Review",
    "description": "合同条款审查、风险识别、修改建议",
    "category": "legal",
    "icon": "file-protect",
    "tags": `["合同","审查","风险"]`,
    "config": `{"autoHighlightRisks":true,"generateReport":true}`,
    "doc_path": "docs/skills/contract-review.md",
    "tools": [
      "contract_clause_library",
      "statute_citation",
      "legal_database_search",
      "file_reader",
      "file_writer",
      "text_analyzer",
      "diff_comparator",
      "note_editor",
      "markdown_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ================================
  // 教育职业技能 (Education Skills)
  // ================================
  {
    "id": "skill_curriculum_design",
    "name": "课程设计",
    "display_name": "Curriculum Design",
    "description": "课程大纲设计、教学计划编制、课堂时间管理",
    "category": "education",
    "icon": "project",
    "tags": `["课程","教学","设计"]`,
    "config": `{"defaultDuration":45,"includeAssessment":true}`,
    "doc_path": "docs/skills/curriculum-design.md",
    "tools": [
      "lesson_timer",
      "template_renderer",
      "file_reader",
      "file_writer",
      "note_editor",
      "markdown_converter",
      "datetime_handler",
      "cron_parser"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_student_assessment",
    "name": "学生评估",
    "display_name": "Student Assessment",
    "description": "成绩计算、评分标准制定、学习进度跟踪",
    "category": "education",
    "icon": "bar-chart",
    "tags": `["评估","成绩","分析"]`,
    "config": `{"gradeSystem":"percentage","autoAnalyze":true}`,
    "doc_path": "docs/skills/student-assessment.md",
    "tools": [
      "grade_calculator",
      "rubric_generator",
      "student_progress_tracker",
      "file_reader",
      "file_writer",
      "data_aggregator",
      "statistical_calculator",
      "chart_data_generator",
      "json_parser",
      "datetime_handler"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_exam_management",
    "name": "考试管理",
    "display_name": "Exam Management",
    "description": "题库管理、自动组卷、考试分析",
    "category": "education",
    "icon": "file-done",
    "tags": `["考试","题库","组卷"]`,
    "config": `{"autoBalance":true,"difficultyDistribution":"normal"}`,
    "doc_path": "docs/skills/exam-management.md",
    "tools": [
      "question_bank_manager",
      "rubric_generator",
      "grade_calculator",
      "file_reader",
      "file_writer",
      "json_parser",
      "markdown_converter",
      "random_generator",
      "file_searcher"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_teaching_analytics",
    "name": "教学分析",
    "display_name": "Teaching Analytics",
    "description": "教学效果分析、学生表现统计、改进建议生成",
    "category": "education",
    "icon": "line-chart",
    "tags": `["分析","统计","改进"]`,
    "config": `{"visualizationEnabled":true,"reportFormat":"markdown"}`,
    "doc_path": "docs/skills/teaching-analytics.md",
    "tools": [
      "student_progress_tracker",
      "grade_calculator",
      "data_aggregator",
      "statistical_calculator",
      "chart_data_generator",
      "trend_detector",
      "text_analyzer",
      "file_reader",
      "file_writer",
      "markdown_converter"
    ],
    "enabled": 1,
    "is_builtin": 1
  },

  // ================================
  // 科研职业技能 (Research Skills)
  // ================================
  {
    "id": "skill_academic_writing",
    "name": "学术写作",
    "display_name": "Academic Writing",
    "description": "论文撰写、文献引用格式化、学术规范检查",
    "category": "research",
    "icon": "edit",
    "tags": `["写作","论文","引用"]`,
    "config": `{"citationStyle":"apa","autoFormat":true}`,
    "doc_path": "docs/skills/academic-writing.md",
    "tools": [
      "citation_formatter",
      "file_reader",
      "file_writer",
      "file_editor",
      "markdown_converter",
      "text_analyzer",
      "language_detector",
      "translator",
      "note_editor",
      "diff_comparator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_research_design",
    "name": "研究设计",
    "display_name": "Research Design",
    "description": "研究方案设计、样本量计算、统计检验力分析",
    "category": "research",
    "icon": "experiment",
    "tags": `["研究","设计","统计"]`,
    "config": `{"defaultAlpha":0.05,"defaultPower":0.8}`,
    "doc_path": "docs/skills/research-design.md",
    "tools": [
      "sample_size_calculator",
      "statistical_power_analysis",
      "research_ethics_checker",
      "file_reader",
      "file_writer",
      "template_renderer",
      "markdown_converter",
      "note_editor"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_data_analysis_research",
    "name": "科研数据分析",
    "display_name": "Research Data Analysis",
    "description": "实验数据分析、统计检验、结果可视化",
    "category": "research",
    "icon": "bar-chart",
    "tags": `["数据分析","统计","可视化"]`,
    "config": `{"confidenceLevel":0.95,"visualizationEnabled":true}`,
    "doc_path": "docs/skills/data-analysis-research.md",
    "tools": [
      "statistical_power_analysis",
      "sample_size_calculator",
      "file_reader",
      "json_parser",
      "data_aggregator",
      "statistical_calculator",
      "chart_data_generator",
      "trend_detector",
      "graph_plotter",
      "data_validator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_literature_management",
    "name": "文献管理",
    "display_name": "Literature Management",
    "description": "文献检索、文献综述、研究空白分析",
    "category": "research",
    "icon": "book",
    "tags": `["文献","综述","检索"]`,
    "config": `{"autoOrganize":true,"tagManagement":true}`,
    "doc_path": "docs/skills/literature-management.md",
    "tools": [
      "literature_gap_analyzer",
      "citation_formatter",
      "info_searcher",
      "file_reader",
      "file_writer",
      "note_editor",
      "note_searcher",
      "text_analyzer",
      "markdown_converter",
      "file_searcher",
      "pdf_text_extractor"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = professionalSkills;
