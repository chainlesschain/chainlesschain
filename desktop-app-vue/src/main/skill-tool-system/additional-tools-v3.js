/**
 * 额外工具定义 V3 - 专业领域工具
 * 支持区块链、房地产、客户成功、变革管理、审计等专业场景
 */

const additionalToolsV3 = [
  {
    "id": "tool_contract_analyzer",
    "name": "智能合约分析器",
    "display_name": "Smart Contract Analyzer",
    "description": "分析智能合约代码，检测安全漏洞、gas优化建议和最佳实践",
    "category": "blockchain",
    "icon": "shield",
    "tags": "[\"智能合约\",\"安全审计\",\"代码分析\"]",
    "config": "{\"analysisDepth\":\"comprehensive\",\"securityFocus\":true}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_blockchain_query",
    "name": "区块链查询工具",
    "display_name": "Blockchain Query Tool",
    "description": "查询区块链数据，包括交易、区块、地址余额等信息",
    "category": "blockchain",
    "icon": "database",
    "tags": "[\"区块链\",\"查询\",\"数据\"]",
    "config": "{\"defaultChain\":\"ethereum\",\"rpcEndpoint\":\"auto\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_tokenomics_simulator",
    "name": "代币经济模拟器",
    "display_name": "Tokenomics Simulator",
    "description": "模拟代币经济模型的长期表现，包括供需、价格、流通等",
    "category": "blockchain",
    "icon": "line-chart",
    "tags": "[\"代币经济\",\"模拟\",\"预测\"]",
    "config": "{\"simulationPeriod\":\"5years\",\"iterations\":1000}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_legal_template_generator",
    "name": "法律文书生成器",
    "display_name": "Legal Template Generator",
    "description": "生成各类法律文书模板，包括合同、协议、申请书等",
    "category": "legal",
    "icon": "file-text",
    "tags": "[\"法律\",\"模板\",\"文书\"]",
    "config": "{\"jurisdiction\":\"CN\",\"language\":\"zh-CN\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_patent_claim_analyzer",
    "name": "专利权利要求分析器",
    "display_name": "Patent Claim Analyzer",
    "description": "分析专利权利要求的保护范围、新颖性和创造性",
    "category": "legal",
    "icon": "search",
    "tags": "[\"专利\",\"分析\",\"知识产权\"]",
    "config": "{\"analysisType\":\"comprehensive\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_market_data_analyzer",
    "name": "市场数据分析器",
    "display_name": "Market Data Analyzer",
    "description": "分析市场数据，包括价格趋势、供需关系、竞争格局等",
    "category": "analysis",
    "icon": "bar-chart",
    "tags": "[\"市场分析\",\"数据\",\"趋势\"]",
    "config": "{\"dataSources\":\"multiple\",\"autoRefresh\":true}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_real_estate_calculator",
    "name": "房地产财务计算器",
    "display_name": "Real Estate Financial Calculator",
    "description": "计算房地产项目的IRR、NPV、现金流等财务指标",
    "category": "finance",
    "icon": "calculator",
    "tags": "[\"房地产\",\"财务\",\"计算器\"]",
    "config": "{\"currency\":\"CNY\",\"discountRate\":\"auto\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_customer_health_scorer",
    "name": "客户健康度评分器",
    "display_name": "Customer Health Score Calculator",
    "description": "计算客户健康度评分，预测续约风险和扩展机会",
    "category": "crm",
    "icon": "heart",
    "tags": "[\"客户成功\",\"健康度\",\"评分\"]",
    "config": "{\"scoringModel\":\"weighted\",\"predictiveAnalytics\":true}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_churn_predictor",
    "name": "客户流失预测器",
    "display_name": "Churn Predictor",
    "description": "基于客户行为数据预测流失风险，提供挽留建议",
    "category": "crm",
    "icon": "alert-triangle",
    "tags": "[\"客户流失\",\"预测\",\"机器学习\"]",
    "config": "{\"modelType\":\"ml\",\"predictionWindow\":\"90days\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_stakeholder_mapper",
    "name": "利益相关者映射工具",
    "display_name": "Stakeholder Mapping Tool",
    "description": "分析和映射项目利益相关者，生成权力-利益矩阵",
    "category": "project",
    "icon": "users",
    "tags": "[\"利益相关者\",\"项目管理\",\"分析\"]",
    "config": "{\"matrixType\":\"power-interest\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_change_readiness_assessor",
    "name": "变革准备度评估器",
    "display_name": "Change Readiness Assessor",
    "description": "评估组织的变革准备度，使用ADKAR或其他框架",
    "category": "management",
    "icon": "clipboard-check",
    "tags": "[\"变革管理\",\"评估\",\"准备度\"]",
    "config": "{\"framework\":\"ADKAR\",\"surveyBased\":true}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_communication_planner",
    "name": "沟通计划工具",
    "display_name": "Communication Planner",
    "description": "规划项目沟通策略，生成沟通矩阵和时间表",
    "category": "project",
    "icon": "message-square",
    "tags": "[\"沟通\",\"项目管理\",\"计划\"]",
    "config": "{\"templateType\":\"stakeholder-based\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_org_chart_generator",
    "name": "组织架构图生成器",
    "display_name": "Organization Chart Generator",
    "description": "生成组织架构图，支持多种格式和样式",
    "category": "hr",
    "icon": "sitemap",
    "tags": "[\"组织架构\",\"图表\",\"HR\"]",
    "config": "{\"chartStyle\":\"hierarchical\",\"exportFormat\":\"svg\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_culture_analyzer",
    "name": "企业文化分析器",
    "display_name": "Culture Analyzer",
    "description": "分析企业文化现状，识别文化差距和改进机会",
    "category": "hr",
    "icon": "compass",
    "tags": "[\"企业文化\",\"分析\",\"组织发展\"]",
    "config": "{\"frameworkType\":\"competing-values\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_event_timeline_creator",
    "name": "活动时间线生成器",
    "display_name": "Event Timeline Generator",
    "description": "创建活动执行时间线，包括里程碑和关键任务",
    "category": "event",
    "icon": "clock",
    "tags": "[\"活动策划\",\"时间线\",\"项目管理\"]",
    "config": "{\"viewType\":\"gantt\",\"autoScheduling\":false}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_press_release_generator",
    "name": "新闻稿生成器",
    "display_name": "Press Release Generator",
    "description": "生成专业新闻稿，符合媒体发布标准",
    "category": "marketing",
    "icon": "file-text",
    "tags": "[\"新闻稿\",\"公关\",\"媒体\"]",
    "config": "{\"style\":\"ap\",\"language\":\"zh-CN\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_media_list_manager",
    "name": "媒体列表管理器",
    "display_name": "Media List Manager",
    "description": "管理媒体联系人列表，分类和追踪媒体关系",
    "category": "marketing",
    "icon": "list",
    "tags": "[\"媒体\",\"公关\",\"关系管理\"]",
    "config": "{\"segmentation\":\"tier-based\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_sentiment_analyzer",
    "name": "舆情分析器",
    "display_name": "Sentiment Analyzer",
    "description": "分析社交媒体和新闻的情感倾向，监测品牌声誉",
    "category": "marketing",
    "icon": "trending-up",
    "tags": "[\"舆情\",\"情感分析\",\"社交媒体\"]",
    "config": "{\"sources\":\"all\",\"realtime\":true}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_audit_risk_assessor",
    "name": "审计风险评估器",
    "display_name": "Audit Risk Assessor",
    "description": "评估审计风险，确定审计重点和资源分配",
    "category": "audit",
    "icon": "alert-circle",
    "tags": "[\"审计\",\"风险评估\",\"合规\"]",
    "config": "{\"riskModel\":\"inherent-control-detection\"}",
    "enabled": 1,
    "is_builtin": 1
  },
  {
    "id": "tool_control_effectiveness_evaluator",
    "name": "内部控制评价器",
    "display_name": "Control Effectiveness Evaluator",
    "description": "评价内部控制的设计和执行有效性",
    "category": "audit",
    "icon": "shield-check",
    "tags": "[\"内部控制\",\"评价\",\"审计\"]",
    "config": "{\"framework\":\"COSO\"}",
    "enabled": 1,
    "is_builtin": 1
  }
];

module.exports = additionalToolsV3;
