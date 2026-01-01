/**
 * 自动生成V3工具的Schema
 * 基于handler实现反推参数定义
 */

const fs = require('fs');
const path = require('path');

// 读取V3工具定义
const v3Tools = require('./src/main/skill-tool-system/additional-tools-v3.js');

// 读取handler实现
const handlerPath = path.join(__dirname, 'src/main/skill-tool-system/additional-tools-v3-handler.js');
const handlerContent = fs.readFileSync(handlerPath, 'utf-8');

// 手动定义的schema（基于handler分析）
const toolSchemas = {
  tool_contract_analyzer: {
    parameters: {
      contractCode: { type: 'string', description: '智能合约源代码', required: true },
      analysisDepth: { type: 'string', enum: ['basic', 'comprehensive'], default: 'comprehensive', description: '分析深度' },
      securityFocus: { type: 'boolean', default: true, description: '是否重点检查安全问题' }
    },
    returns: {
      success: 'boolean',
      issues: 'array of security issues',
      optimizations: 'array of optimization suggestions',
      bestPractices: 'array of best practice recommendations',
      error: 'string'
    },
    examples: [{
      description: '分析Solidity智能合约',
      params: {
        contractCode: 'pragma solidity ^0.8.0; contract MyToken { ... }',
        analysisDepth: 'comprehensive',
        securityFocus: true
      }
    }],
    permissions: ['code:analyze'],
    riskLevel: 2
  },

  tool_blockchain_query: {
    parameters: {
      chain: { type: 'string', enum: ['ethereum', 'bsc', 'polygon'], default: 'ethereum', description: '区块链网络' },
      queryType: { type: 'string', enum: ['transaction', 'block', 'address', 'balance'], required: true, description: '查询类型' },
      identifier: { type: 'string', required: true, description: '查询标识符（交易哈希/区块号/地址）' }
    },
    returns: {
      success: 'boolean',
      data: 'object - 查询结果',
      error: 'string'
    },
    examples: [{
      description: '查询以太坊地址余额',
      params: {
        chain: 'ethereum',
        queryType: 'balance',
        identifier: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb'
      }
    }],
    permissions: ['network:request'],
    riskLevel: 1
  },

  tool_tokenomics_simulator: {
    parameters: {
      tokenConfig: { type: 'object', required: true, description: '代币配置（总量、分配等）' },
      simulationPeriod: { type: 'string', default: '5years', description: '模拟周期' },
      iterations: { type: 'number', default: 1000, description: '模拟迭代次数' }
    },
    returns: {
      success: 'boolean',
      simulations: 'array of simulation results',
      summary: 'object - 统计摘要',
      error: 'string'
    },
    examples: [{
      description: '模拟代币经济模型',
      params: {
        tokenConfig: {
          totalSupply: 1000000000,
          initialPrice: 0.1,
          distributions: { team: 0.2, investors: 0.3, public: 0.5 }
        },
        simulationPeriod: '5years'
      }
    }],
    permissions: ['compute:intensive'],
    riskLevel: 1
  },

  tool_legal_template_generator: {
    parameters: {
      templateType: { type: 'string', enum: ['contract', 'agreement', 'notice', 'application'], required: true, description: '文书类型' },
      jurisdiction: { type: 'string', default: 'CN', description: '法律管辖区' },
      variables: { type: 'object', required: true, description: '模板变量' }
    },
    returns: {
      success: 'boolean',
      document: 'string - 生成的法律文书',
      error: 'string'
    },
    examples: [{
      description: '生成劳动合同',
      params: {
        templateType: 'contract',
        jurisdiction: 'CN',
        variables: { employeeName: '张三', position: '软件工程师', startDate: '2024-01-01' }
      }
    }],
    permissions: ['file:write'],
    riskLevel: 2
  },

  tool_patent_claim_analyzer: {
    parameters: {
      claimText: { type: 'string', required: true, description: '专利权利要求文本' },
      analysisType: { type: 'string', enum: ['basic', 'comprehensive'], default: 'comprehensive', description: '分析类型' }
    },
    returns: {
      success: 'boolean',
      analysis: 'object - 分析结果',
      suggestions: 'array',
      error: 'string'
    },
    examples: [{
      description: '分析专利权利要求',
      params: {
        claimText: '一种智能手机的触摸屏组件，其特征在于...',
        analysisType: 'comprehensive'
      }
    }],
    permissions: ['text:analyze'],
    riskLevel: 1
  },

  tool_market_data_analyzer: {
    parameters: {
      market: { type: 'string', required: true, description: '市场名称' },
      dataSources: { type: 'array', default: ['multiple'], description: '数据源' },
      metrics: { type: 'array', default: ['price', 'volume', 'trend'], description: '分析指标' }
    },
    returns: {
      success: 'boolean',
      analysis: 'object',
      trends: 'array',
      error: 'string'
    },
    examples: [{
      description: '分析股票市场',
      params: {
        market: 'AAPL',
        metrics: ['price', 'volume', 'trend']
      }
    }],
    permissions: ['network:request'],
    riskLevel: 1
  },

  tool_real_estate_calculator: {
    parameters: {
      projectData: { type: 'object', required: true, description: '项目数据（成本、收入、周期等）' },
      discountRate: { type: 'number', default: 0.08, description: '折现率' },
      currency: { type: 'string', default: 'CNY', description: '货币单位' }
    },
    returns: {
      success: 'boolean',
      irr: 'number - 内部收益率',
      npv: 'number - 净现值',
      cashFlows: 'array',
      error: 'string'
    },
    examples: [{
      description: '计算房地产项目IRR和NPV',
      params: {
        projectData: {
          investment: 10000000,
          revenues: [2000000, 3000000, 4000000, 5000000],
          costs: [500000, 600000, 700000, 800000]
        },
        discountRate: 0.08
      }
    }],
    permissions: ['compute:intensive'],
    riskLevel: 1
  },

  tool_customer_health_scorer: {
    parameters: {
      customerData: { type: 'object', required: true, description: '客户数据' },
      scoringModel: { type: 'string', enum: ['simple', 'weighted', 'ml'], default: 'weighted', description: '评分模型' }
    },
    returns: {
      success: 'boolean',
      healthScore: 'number - 健康度评分（0-100）',
      riskLevel: 'string',
      recommendations: 'array',
      error: 'string'
    },
    examples: [{
      description: '计算客户健康度评分',
      params: {
        customerData: {
          usage: 85,
          engagement: 90,
          support_tickets: 2,
          nps_score: 8
        },
        scoringModel: 'weighted'
      }
    }],
    permissions: ['data:analyze'],
    riskLevel: 1
  },

  tool_churn_predictor: {
    parameters: {
      customerData: { type: 'object', required: true, description: '客户行为数据' },
      modelType: { type: 'string', enum: ['simple', 'ml'], default: 'ml', description: '预测模型类型' },
      predictionWindow: { type: 'string', default: '90days', description: '预测窗口期' }
    },
    returns: {
      success: 'boolean',
      churnProbability: 'number - 流失概率（0-1）',
      riskFactors: 'array',
      recommendations: 'array',
      error: 'string'
    },
    examples: [{
      description: '预测客户流失风险',
      params: {
        customerData: {
          last_login_days: 30,
          usage_decline: 0.5,
          support_tickets: 5,
          payment_delays: 2
        },
        modelType: 'ml'
      }
    }],
    permissions: ['data:analyze', 'ml:predict'],
    riskLevel: 2
  },

  // 其他工具使用通用schema模板
  _generic: {
    parameters: {
      input: { type: 'object', required: true, description: '输入数据' },
      options: { type: 'object', description: '配置选项' }
    },
    returns: {
      success: 'boolean',
      data: 'object',
      error: 'string'
    },
    examples: [{
      description: '使用工具',
      params: { input: {}, options: {} }
    }],
    permissions: [],
    riskLevel: 1
  }
};

// 为剩余工具使用智能推断
const remainingTools = [
  'tool_stakeholder_mapper',
  'tool_change_readiness_assessor',
  'tool_communication_planner',
  'tool_org_chart_generator',
  'tool_culture_analyzer',
  'tool_event_timeline_creator',
  'tool_press_release_generator',
  'tool_media_list_manager',
  'tool_sentiment_analyzer',
  'tool_audit_risk_assessor',
  'tool_control_effectiveness_evaluator',
  'tool_code_generator',
  'tool_financial_calculator',
  'tool_simulation_runner',
  'tool_crm_integrator',
  'tool_competency_framework',
  'tool_budget_calculator',
  'tool_vendor_manager',
  'tool_evidence_documenter'
];

// 根据工具类型和描述推断schema
function inferSchema(tool) {
  const id = tool.id;
  const category = tool.category;

  // 基础模板
  let schema = {
    parameters: {},
    returns: {
      success: 'boolean',
      data: 'object',
      error: 'string'
    },
    examples: [{
      description: `使用${tool.display_name}`,
      params: {}
    }],
    permissions: [],
    riskLevel: 1
  };

  // 根据类别调整
  if (category === 'hr') {
    schema.parameters.organizationData = { type: 'object', required: true, description: '组织数据' };
    schema.permissions = ['data:read'];
  } else if (category === 'project') {
    schema.parameters.projectData = { type: 'object', required: true, description: '项目数据' };
    schema.permissions = ['data:read', 'data:write'];
  } else if (category === 'marketing') {
    schema.parameters.content = { type: 'string', required: true, description: '内容' };
    schema.permissions = ['text:generate'];
  } else if (category === 'audit') {
    schema.parameters.auditData = { type: 'object', required: true, description: '审计数据' };
    schema.permissions = ['data:read', 'data:analyze'];
    schema.riskLevel = 2;
  } else if (category === 'finance') {
    schema.parameters.financialData = { type: 'object', required: true, description: '财务数据' };
    schema.permissions = ['data:read', 'compute:intensive'];
  } else if (category === 'crm') {
    schema.parameters.crmData = { type: 'object', required: true, description: 'CRM数据' };
    schema.permissions = ['data:read', 'network:request'];
    schema.riskLevel = 2;
  } else if (category === 'code') {
    schema.parameters.codeSpec = { type: 'object', required: true, description: '代码规格' };
    schema.permissions = ['code:generate'];
    schema.riskLevel = 2;
  }

  // 添加通用选项参数
  schema.parameters.options = { type: 'object', description: '配置选项' };

  return schema;
}

console.log('=== 生成V3工具完整Schema ===\n');

const completeTools = [];

v3Tools.forEach(tool => {
  // 获取schema（预定义或推断）
  const schema = toolSchemas[tool.id] || inferSchema(tool);

  // 构建完整工具定义
  const completeTool = {
    id: tool.id,
    name: tool.name,
    display_name: tool.display_name,
    description: tool.description,
    category: tool.category,
    tool_type: 'function',

    // 构建parameters_schema
    parameters_schema: {
      type: 'object',
      properties: {},
      required: []
    },

    // 构建return_schema
    return_schema: {
      type: 'object',
      properties: typeof schema.returns === 'object' && !Array.isArray(schema.returns)
        ? Object.entries(schema.returns).reduce((acc, [key, val]) => {
            if (typeof val === 'string') {
              const parts = val.split(' - ');
              const typePart = parts[0].trim();
              const descPart = parts.slice(1).join(' - ').trim();

              // 解析type
              let finalType = 'string';
              if (typePart === 'boolean') finalType = 'boolean';
              else if (typePart === 'number') finalType = 'number';
              else if (typePart === 'object') finalType = 'object';
              else if (typePart.startsWith('array')) finalType = 'array';

              acc[key] = {
                type: finalType,
                description: descPart || typePart
              };

              if (finalType === 'array') {
                acc[key].items = { type: 'object' };
              }
            } else {
              acc[key] = val;
            }
            return acc;
          }, {})
        : {
            success: { type: 'boolean' },
            data: { type: 'object' },
            error: { type: 'string' }
          }
    },

    examples: schema.examples || [],
    required_permissions: schema.permissions || [],
    risk_level: schema.riskLevel || 1,
    is_builtin: 1,
    enabled: 1
  };

  // 填充parameters_schema
  Object.entries(schema.parameters).forEach(([key, val]) => {
    completeTool.parameters_schema.properties[key] = {
      type: val.type,
      description: val.description
    };

    if (val.enum) completeTool.parameters_schema.properties[key].enum = val.enum;
    if (val.default !== undefined) completeTool.parameters_schema.properties[key].default = val.default;
    if (val.required) completeTool.parameters_schema.required.push(key);
  });

  completeTools.push(completeTool);
});

// 输出到文件
const outputPath = path.join(__dirname, 'v3-tools-complete.json');
fs.writeFileSync(outputPath, JSON.stringify(completeTools, null, 2));

console.log(`✅ 已生成 ${completeTools.length} 个完整工具定义`);
console.log(`📄 输出文件: ${outputPath}`);
console.log('\n前3个工具示例:\n');
completeTools.slice(0, 3).forEach(tool => {
  console.log(`${tool.id}:`);
  console.log(`  参数: ${Object.keys(tool.parameters_schema.properties).join(', ')}`);
  console.log(`  权限: ${tool.required_permissions.join(', ')}`);
  console.log(`  风险等级: ${tool.risk_level}`);
  console.log('');
});
