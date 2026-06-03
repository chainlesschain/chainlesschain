/**
 * blockchain-tools - Auto-generated from builtin-tools.js split
 * 13 tools
 */

module.exports = [
  {
    id: "tool_blockchain_client",
    name: "blockchain_client",
    display_name: "区块链客户端",
    description: "连接区块链网络，查询区块、交易信息",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        network: {
          type: "string",
          description: "区块链网络",
          enum: ["ethereum", "bsc", "polygon", "bitcoin"],
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["getBlock", "getTransaction", "getBalance", "getGasPrice"],
        },
        params: {
          type: "object",
          description: "操作参数",
        },
      },
      required: ["network", "action"],
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
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础区块链操作",
        params: {
          network: "ethereum",
          action: "getBlock",
          params: "value",
        },
      },
      {
        description: "高级智能合约",
        params: {
          network: "bsc",
          action: "getTransaction",
          params: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_smart_contract_caller",
    name: "smart_contract_caller",
    display_name: "智能合约调用器",
    description: "调用智能合约函数、发送交易",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "合约地址",
        },
        abi: {
          type: "array",
          description: "合约ABI",
        },
        method: {
          type: "string",
          description: "方法名",
        },
        args: {
          type: "array",
          description: "方法参数",
        },
        from: {
          type: "string",
          description: "调用者地址",
        },
      },
      required: ["contractAddress", "abi", "method"],
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
        transactionHash: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础区块链操作",
        params: {
          contractAddress: "value",
          abi: ["item1", "item2"],
          method: "value",
          args: ["item1", "item2"],
          from: "value",
        },
      },
      {
        description: "高级智能合约",
        params: {
          contractAddress: "advanced_value",
          abi: ["item1", "item2", "item3", "item4"],
          method: "advanced_value",
          args: ["item1", "item2", "item3", "item4"],
          from: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http", "wallet:access"],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_wallet_manager",
    name: "wallet_manager",
    display_name: "钱包管理器",
    description: "创建钱包、导入私钥、签名交易",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "import", "sign", "export"],
        },
        privateKey: {
          type: "string",
          description: "私钥（导入时使用）",
        },
        mnemonic: {
          type: "string",
          description: "助记词",
        },
        transaction: {
          type: "object",
          description: "要签名的交易",
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
        address: {
          type: "string",
        },
        privateKey: {
          type: "string",
        },
        mnemonic: {
          type: "string",
        },
        signature: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基础区块链操作",
        params: {
          action: "create",
          privateKey: "value",
          mnemonic: "value",
          transaction: "value",
        },
      },
      {
        description: "高级智能合约",
        params: {
          action: "import",
          privateKey: "advanced_value",
          mnemonic: "advanced_value",
          transaction: "advanced_value",
        },
      },
    ],
    required_permissions: ["wallet:create"],
    risk_level: 5,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_contract_analyzer",
    name: "contract_analyzer",
    display_name: "智能合约分析器 / Smart Contract Analyzer",
    description: "分析智能合约代码，检测安全漏洞、gas优化建议和最佳实践",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        contractCode: {
          type: "string",
          description: "智能合约源代码",
        },
        analysisDepth: {
          type: "string",
          description: "分析深度",
          enum: ["basic", "comprehensive"],
          default: "comprehensive",
        },
        securityFocus: {
          type: "boolean",
          description: "是否重点检查安全问题",
          default: true,
        },
      },
      required: ["contractCode"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        issues: {
          type: "array",
          description: "array of security issues",
          items: {
            type: "object",
          },
        },
        optimizations: {
          type: "array",
          description: "array of optimization suggestions",
          items: {
            type: "object",
          },
        },
        bestPractices: {
          type: "array",
          description: "array of best practice recommendations",
          items: {
            type: "object",
          },
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "基础区块链操作",
        params: {
          contractCode: "value",
          analysisDepth: "basic",
          securityFocus: false,
        },
      },
      {
        description: "高级智能合约",
        params: {
          contractCode: "advanced_value",
          analysisDepth: "comprehensive",
          securityFocus: true,
        },
      },
    ],
    required_permissions: ["code:analyze"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_blockchain_query",
    name: "blockchain_query",
    display_name: "区块链查询工具 / Blockchain Query Tool",
    description: "查询区块链数据，包括交易、区块、地址余额等信息",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          description: "区块链网络",
          enum: ["ethereum", "bsc", "polygon"],
          default: "ethereum",
        },
        queryType: {
          type: "string",
          description: "查询类型",
          enum: ["transaction", "block", "address", "balance"],
        },
        identifier: {
          type: "string",
          description: "查询标识符（交易哈希/区块号/地址）",
        },
      },
      required: ["queryType", "identifier"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "查询结果",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "区块链查询工具 基础用法",
        params: {
          chain: "ethereum",
          queryType: "搜索关键词",
          identifier: "value",
        },
      },
      {
        description: "区块链查询工具 高级用法",
        params: {
          chain: "bsc",
          queryType: "复杂查询：条件A AND 条件B",
          identifier: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_tokenomics_simulator",
    name: "tokenomics_simulator",
    display_name: "代币经济模拟器 / Tokenomics Simulator",
    description: "模拟代币经济模型的长期表现，包括供需、价格、流通等",
    category: "blockchain",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        tokenConfig: {
          type: "object",
          description: "代币配置（总量、分配等）",
        },
        simulationPeriod: {
          type: "string",
          description: "模拟周期",
          default: "5years",
        },
        iterations: {
          type: "number",
          description: "模拟迭代次数",
          default: 1000,
        },
      },
      required: ["tokenConfig"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        simulations: {
          type: "array",
          description: "array of simulation results",
          items: {
            type: "object",
          },
        },
        summary: {
          type: "object",
          description: "统计摘要",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "代币经济模拟器 基础用法",
        params: {
          tokenConfig: "value",
          simulationPeriod: "5years",
          iterations: 10,
        },
      },
      {
        description: "代币经济模拟器 高级用法",
        params: {
          tokenConfig: "advanced_value",
          simulationPeriod: "5years",
          iterations: 50,
        },
      },
    ],
    required_permissions: ["compute:intensive"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_real_estate_calculator",
    name: "real_estate_calculator",
    display_name: "房地产财务计算器 / Real Estate Financial Calculator",
    description: "计算房地产项目的IRR、NPV、现金流等财务指标",
    category: "finance",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectData: {
          type: "object",
          description: "项目数据（成本、收入、周期等）",
        },
        discountRate: {
          type: "number",
          description: "折现率",
          default: 0.08,
        },
        currency: {
          type: "string",
          description: "货币单位",
          default: "CNY",
        },
      },
      required: ["projectData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        irr: {
          type: "number",
          description: "内部收益率",
        },
        npv: {
          type: "number",
          description: "净现值",
        },
        cashFlows: {
          type: "array",
          description: "array",
          items: {
            type: "object",
          },
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "房地产财务计算器 基础用法",
        params: {
          projectData: "value",
          discountRate: 10,
          currency: "CNY",
        },
      },
      {
        description: "房地产财务计算器 高级用法",
        params: {
          projectData: "advanced_value",
          discountRate: 50,
          currency: "CNY",
        },
      },
    ],
    required_permissions: ["compute:intensive"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_customer_health_scorer",
    name: "health_score_calculator",
    display_name: "客户健康度评分器 / Customer Health Score Calculator",
    description: "计算客户健康度评分，预测续约风险和扩展机会",
    category: "crm",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        customerData: {
          type: "object",
          description: "客户数据",
        },
        scoringModel: {
          type: "string",
          description: "评分模型",
          enum: ["simple", "weighted", "ml"],
          default: "weighted",
        },
      },
      required: ["customerData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        healthScore: {
          type: "number",
          description: "健康度评分（0-100）",
        },
        riskLevel: {
          type: "string",
          description: "string",
        },
        recommendations: {
          type: "array",
          description: "array",
          items: {
            type: "object",
          },
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "客户健康度评分器 基础用法",
        params: {
          customerData: "value",
          scoringModel: "base_model",
        },
      },
      {
        description: "客户健康度评分器 高级用法",
        params: {
          customerData: "advanced_value",
          scoringModel: "advanced_model_v2",
        },
      },
    ],
    required_permissions: ["data:analyze"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_churn_predictor",
    name: "churn_predictor",
    display_name: "客户流失预测器 / Churn Predictor",
    description: "基于客户行为数据预测流失风险，提供挽留建议",
    category: "crm",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        customerData: {
          type: "object",
          description: "客户行为数据",
        },
        modelType: {
          type: "string",
          description: "预测模型类型",
          enum: ["simple", "ml"],
          default: "ml",
        },
        predictionWindow: {
          type: "string",
          description: "预测窗口期",
          default: "90days",
        },
      },
      required: ["customerData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        churnProbability: {
          type: "number",
          description: "流失概率（0-1）",
        },
        riskFactors: {
          type: "array",
          description: "array",
          items: {
            type: "object",
          },
        },
        recommendations: {
          type: "array",
          description: "array",
          items: {
            type: "object",
          },
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "客户流失预测器 基础用法",
        params: {
          customerData: "value",
          modelType: "base_model",
          predictionWindow: "90days",
        },
      },
      {
        description: "客户流失预测器 高级用法",
        params: {
          customerData: "advanced_value",
          modelType: "advanced_model_v2",
          predictionWindow: "90days",
        },
      },
    ],
    required_permissions: ["data:analyze", "ml:predict"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_financial_calculator",
    name: "financial_calculator",
    display_name: "财务计算器 / Financial Calculator",
    description: "计算各类财务指标，包括NPV、IRR、ROI、现值、终值等",
    category: "finance",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        financialData: {
          type: "object",
          description: "财务数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["financialData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "财务计算器 基础用法",
        params: {
          financialData: "value",
          options: "value",
        },
      },
      {
        description: "财务计算器 高级用法",
        params: {
          financialData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "compute:intensive"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_crm_integrator",
    name: "crm_integrator",
    display_name: "CRM集成器 / CRM Integrator",
    description: "集成主流CRM系统（Salesforce、HubSpot、Zoho等），同步客户数据",
    category: "crm",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        crmData: {
          type: "object",
          description: "CRM数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["crmData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "CRM集成器 基础用法",
        params: {
          crmData: "value",
          options: "value",
        },
      },
      {
        description: "CRM集成器 高级用法",
        params: {
          crmData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "network:request"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_budget_calculator",
    name: "budget_calculator",
    display_name: "预算计算器 / Budget Calculator",
    description: "计算和管理项目预算，支持成本分解、预算跟踪、差异分析",
    category: "finance",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        financialData: {
          type: "object",
          description: "财务数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["financialData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "预算计算器 基础用法",
        params: {
          financialData: "value",
          options: "value",
        },
      },
      {
        description: "预算计算器 高级用法",
        params: {
          financialData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "compute:intensive"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_vendor_manager",
    name: "vendor_manager",
    display_name: "供应商管理器 / Vendor Manager",
    description: "管理供应商信息、合同、绩效评估、付款跟踪",
    category: "procurement",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: [],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "供应商管理器 基础用法",
        params: {
          options: "value",
        },
      },
      {
        description: "供应商管理器 高级用法",
        params: {
          options: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
];
