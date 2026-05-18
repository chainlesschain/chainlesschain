/**
 * 额外技能定义 V3 - 专业领域技能
 * 支持区块链、房地产、客户成功、变革管理、审计等专业场景
 */

const additionalSkillsV3 = [
  {
    "id": "skill_blockchain_development",
    "name": "区块链开发",
    "display_name": "Blockchain Development",
    "description": "提供区块链技术开发能力，包括智能合约开发、DApp构建、Web3集成",
    "category": "blockchain",
    "icon": "link",
    "tags": "[\"区块链\",\"Web3\",\"智能合约\",\"DApp\"]",
    "config": "{\"defaultChain\":\"ethereum\",\"contractLanguage\":\"solidity\"}",
    "doc_path": "docs/skills/blockchain-development.md",
    "tools": [
      "file_writer",
      "code_generator",
      "contract_analyzer",
      "blockchain_query"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_tokenomics_design",
    "name": "代币经济设计",
    "display_name": "Tokenomics Design",
    "description": "设计代币经济模型，包括分配方案、激励机制、价值捕获等",
    "category": "blockchain",
    "icon": "dollar",
    "tags": "[\"代币经济\",\"经济模型\",\"激励设计\"]",
    "config": "{\"modelType\":\"deflationary\"}",
    "doc_path": "docs/skills/tokenomics-design.md",
    "tools": [
      "excel_generator",
      "financial_calculator",
      "chart_generator",
      "simulation_runner"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_patent_writing",
    "name": "专利撰写",
    "display_name": "Patent Writing",
    "description": "撰写专利申请文件，包括权利要求书、说明书、技术方案描述",
    "category": "legal",
    "icon": "copyright",
    "tags": "[\"专利\",\"知识产权\",\"法律文书\"]",
    "config": "{\"patentType\":\"invention\",\"language\":\"zh-CN\"}",
    "doc_path": "docs/skills/patent-writing.md",
    "tools": [
      "word_generator",
      "legal_template_generator",
      "claim_analyzer"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_real_estate_analysis",
    "name": "房地产分析",
    "display_name": "Real Estate Analysis",
    "description": "房地产项目投资分析，包括市场调研、财务测算、风险评估",
    "category": "finance",
    "icon": "home",
    "tags": "[\"房地产\",\"投资分析\",\"财务建模\"]",
    "config": "{\"analysisType\":\"investment\",\"irr_calculation\":true}",
    "doc_path": "docs/skills/real-estate-analysis.md",
    "tools": [
      "excel_generator",
      "financial_calculator",
      "market_data_analyzer",
      "chart_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_customer_success_management",
    "name": "客户成功管理",
    "display_name": "Customer Success Management",
    "description": "SaaS客户成功运营，包括客户生命周期管理、健康度评分、续约策略",
    "category": "business",
    "icon": "user-check",
    "tags": "[\"客户成功\",\"CSM\",\"SaaS\",\"客户留存\"]",
    "config": "{\"defaultMetric\":\"NRR\",\"healthScoreEnabled\":true}",
    "doc_path": "docs/skills/customer-success-management.md",
    "tools": [
      "crm_integrator",
      "health_score_calculator",
      "churn_predictor",
      "excel_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_change_management",
    "name": "变革管理",
    "display_name": "Change Management",
    "description": "组织变革管理，包括利益相关者分析、沟通策略、阻力管理",
    "category": "management",
    "icon": "repeat",
    "tags": "[\"变革管理\",\"组织发展\",\"项目管理\"]",
    "config": "{\"framework\":\"ADKAR\",\"stakeholderMapping\":true}",
    "doc_path": "docs/skills/change-management.md",
    "tools": [
      "stakeholder_analyzer",
      "readiness_assessor",
      "communication_planner",
      "word_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_organizational_development",
    "name": "组织发展",
    "display_name": "Organizational Development",
    "description": "组织架构设计、文化建设、人才发展规划",
    "category": "hr",
    "icon": "sitemap",
    "tags": "[\"组织发展\",\"OD\",\"人力资源\"]",
    "config": "{\"assessmentType\":\"culture\"}",
    "doc_path": "docs/skills/organizational-development.md",
    "tools": [
      "org_chart_generator",
      "culture_analyzer",
      "competency_framework",
      "ppt_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_event_planning",
    "name": "活动策划",
    "display_name": "Event Planning",
    "description": "大型活动策划与执行，包括流程设计、预算管理、供应商协调",
    "category": "marketing",
    "icon": "calendar",
    "tags": "[\"活动策划\",\"会议\",\"发布会\"]",
    "config": "{\"eventType\":\"conference\",\"budgetTracking\":true}",
    "doc_path": "docs/skills/event-planning.md",
    "tools": [
      "event_timeline_generator",
      "budget_calculator",
      "vendor_manager",
      "ppt_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_public_relations",
    "name": "公共关系",
    "display_name": "Public Relations",
    "description": "公关传播策略、新闻稿撰写、媒体关系管理、舆情应对",
    "category": "marketing",
    "icon": "megaphone",
    "tags": "[\"公关\",\"PR\",\"媒体\",\"传播\"]",
    "config": "{\"mediaType\":\"all\",\"crisisManagement\":true}",
    "doc_path": "docs/skills/public-relations.md",
    "tools": [
      "press_release_generator",
      "media_list_manager",
      "sentiment_analyzer",
      "word_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "skill_internal_audit",
    "name": "内部审计",
    "display_name": "Internal Audit",
    "description": "内部审计执行，包括风险评估、审计程序设计、审计报告撰写",
    "category": "finance",
    "icon": "search",
    "tags": "[\"内部审计\",\"合规\",\"风险管理\"]",
    "config": "{\"auditType\":\"comprehensive\",\"riskBased\":true}",
    "doc_path": "docs/skills/internal-audit.md",
    "tools": [
      "risk_assessor",
      "control_evaluator",
      "evidence_documenter",
      "word_generator",
      "excel_generator"
    ],
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = additionalSkillsV3;
