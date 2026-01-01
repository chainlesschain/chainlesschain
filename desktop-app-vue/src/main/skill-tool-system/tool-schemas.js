/**
 * Additional Tools V3 - JSON Schema定义
 * 为27个专业领域工具定义详细的参数和返回值Schema
 */

const toolSchemas = {
  // ==================== 区块链工具 ====================

  contract_analyzer: {
    name: 'contract_analyzer',
    display_name: '智能合约分析器 / Smart Contract Analyzer',
    description: '分析智能合约代码，检测安全漏洞、gas优化建议和最佳实践',
    category: 'blockchain',
    parameters: {
      type: 'object',
      properties: {
        contractCode: {
          type: 'string',
          description: '智能合约源代码（Solidity）',
          minLength: 1,
          example: 'pragma solidity ^0.8.0;\ncontract MyContract { ... }'
        },
        analysisDepth: {
          type: 'string',
          description: '分析深度级别',
          enum: ['basic', 'standard', 'comprehensive'],
          default: 'standard'
        },
        securityFocus: {
          type: 'boolean',
          description: '是否重点关注安全问题',
          default: true
        }
      },
      required: ['contractCode']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        analysis: {
          type: 'object',
          properties: {
            contractSize: { type: 'number', description: '合约代码大小（字符数）' },
            riskScore: { type: 'number', description: '风险评分 (0-100)', minimum: 0, maximum: 100 },
            riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                  type: { type: 'string' },
                  message: { type: 'string' },
                  line: { type: 'number', nullable: true }
                }
              }
            },
            optimizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  message: { type: 'string' },
                  estimatedSaving: { type: 'string' }
                }
              }
            },
            bestPractices: { type: 'array', items: { type: 'string' } }
          }
        },
        timestamp: { type: 'number' }
      }
    },
    examples: [
      {
        input: {
          contractCode: 'pragma solidity ^0.8.0;\ncontract SimpleStorage {\n  uint256 value;\n  function setValue(uint256 _value) public {\n    value = _value;\n  }\n}',
          analysisDepth: 'comprehensive',
          securityFocus: true
        },
        output: {
          success: true,
          analysis: {
            contractSize: 150,
            riskScore: 15,
            riskLevel: 'low',
            issues: [],
            optimizations: [],
            bestPractices: ['Add SPDX license identifier', 'Use events for state changes']
          }
        }
      }
    ]
  },

  blockchain_query: {
    name: 'blockchain_query',
    display_name: '区块链查询工具 / Blockchain Query Tool',
    description: '查询区块链数据，包括交易、区块、地址余额等信息',
    category: 'blockchain',
    parameters: {
      type: 'object',
      properties: {
        queryType: {
          type: 'string',
          description: '查询类型',
          enum: ['balance', 'transaction', 'block'],
          example: 'balance'
        },
        address: {
          type: 'string',
          description: '区块链地址（用于balance查询）',
          pattern: '^0x[a-fA-F0-9]{40}$',
          example: '0x1234567890123456789012345678901234567890'
        },
        txHash: {
          type: 'string',
          description: '交易哈希（用于transaction查询）',
          pattern: '^0x[a-fA-F0-9]{64}$'
        },
        blockNumber: {
          type: 'number',
          description: '区块号（用于block查询）',
          minimum: 0
        },
        chain: {
          type: 'string',
          description: '区块链网络',
          enum: ['ethereum', 'bsc', 'polygon', 'arbitrum'],
          default: 'ethereum'
        }
      },
      required: ['queryType'],
      oneOf: [
        { properties: { queryType: { const: 'balance' } }, required: ['address'] },
        { properties: { queryType: { const: 'transaction' } }, required: ['txHash'] },
        { properties: { queryType: { const: 'block' } }, required: ['blockNumber'] }
      ]
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        queryType: { type: 'string' },
        chain: { type: 'string' },
        data: { type: 'object' },
        timestamp: { type: 'number' }
      }
    }
  },

  tokenomics_simulator: {
    name: 'tokenomics_simulator',
    display_name: '代币经济模拟器 / Tokenomics Simulator',
    description: '模拟代币经济模型的长期表现，包括供需、价格、流通等',
    category: 'blockchain',
    parameters: {
      type: 'object',
      properties: {
        initialSupply: {
          type: 'number',
          description: '初始供应量',
          minimum: 0,
          example: 1000000
        },
        maxSupply: {
          type: 'number',
          description: '最大供应量',
          minimum: 0,
          example: 10000000
        },
        initialPrice: {
          type: 'number',
          description: '初始价格（美元）',
          minimum: 0,
          example: 0.1
        },
        inflationRate: {
          type: 'number',
          description: '年通胀率（%）',
          minimum: 0,
          maximum: 100,
          default: 0
        },
        burnRate: {
          type: 'number',
          description: '年销毁率（%）',
          minimum: 0,
          maximum: 100,
          default: 0
        },
        simulationPeriod: {
          type: 'string',
          description: '模拟周期',
          pattern: '^\\d+years?$',
          default: '5years'
        },
        iterations: {
          type: 'number',
          description: '蒙特卡洛模拟迭代次数',
          minimum: 100,
          maximum: 10000,
          default: 1000
        }
      },
      required: ['initialSupply', 'maxSupply', 'initialPrice']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        simulation: {
          type: 'object',
          properties: {
            parameters: { type: 'object' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  year: { type: 'number' },
                  supply: { type: 'number' },
                  price: { type: 'number' },
                  marketCap: { type: 'number' },
                  circulationRate: { type: 'number' }
                }
              }
            },
            summary: { type: 'object' }
          }
        }
      }
    }
  },

  // ==================== 法律工具 ====================

  legal_template_generator: {
    name: 'legal_template_generator',
    display_name: '法律文书生成器 / Legal Template Generator',
    description: '生成各类法律文书模板，包括合同、协议、申请书等',
    category: 'legal',
    parameters: {
      type: 'object',
      properties: {
        documentType: {
          type: 'string',
          description: '文书类型',
          enum: ['employment-contract', 'nda', 'service-agreement', 'purchase-contract'],
          example: 'nda'
        },
        jurisdiction: {
          type: 'string',
          description: '法律管辖区',
          enum: ['CN', 'US', 'UK', 'EU'],
          default: 'CN'
        },
        language: {
          type: 'string',
          description: '文档语言',
          enum: ['zh-CN', 'en-US'],
          default: 'zh-CN'
        },
        parties: {
          type: 'array',
          description: '合同各方名称',
          items: { type: 'string' },
          minItems: 2,
          example: ['甲方公司', '乙方公司']
        },
        terms: {
          type: 'object',
          description: '合同条款',
          additionalProperties: true
        },
        customClauses: {
          type: 'array',
          description: '自定义条款',
          items: { type: 'string' },
          default: []
        }
      },
      required: ['documentType', 'parties']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        document: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            jurisdiction: { type: 'string' },
            language: { type: 'string' },
            filePath: { type: 'string' },
            fileName: { type: 'string' },
            preview: { type: 'string' },
            metadata: { type: 'object' }
          }
        }
      }
    }
  },

  claim_analyzer: {
    name: 'claim_analyzer',
    display_name: '专利权利要求分析器 / Patent Claim Analyzer',
    description: '分析专利权利要求的保护范围、新颖性和创造性',
    category: 'legal',
    parameters: {
      type: 'object',
      properties: {
        claimText: {
          type: 'string',
          description: '权利要求文本',
          minLength: 10
        },
        analysisType: {
          type: 'string',
          description: '分析类型',
          enum: ['basic', 'comprehensive'],
          default: 'comprehensive'
        },
        priorArt: {
          type: 'array',
          description: '现有技术文献',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' }
            }
          },
          default: []
        }
      },
      required: ['claimText']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        analysis: {
          type: 'object',
          properties: {
            scope: { type: 'object' },
            novelty: { type: 'object' },
            creativity: { type: 'object' },
            overallAssessment: { type: 'object' }
          }
        }
      }
    }
  },

  // ==================== 财务工具 ====================

  financial_calculator: {
    name: 'financial_calculator',
    display_name: '财务计算器 / Financial Calculator',
    description: '计算各类财务指标，包括NPV、IRR、ROI、现值、终值等',
    category: 'finance',
    parameters: {
      type: 'object',
      properties: {
        calculationType: {
          type: 'string',
          description: '计算类型',
          enum: ['npv', 'irr', 'roi', 'fv', 'pv'],
          example: 'npv'
        },
        cashFlows: {
          type: 'array',
          description: '现金流数组（第一个为初始投资，通常为负数）',
          items: { type: 'number' },
          minItems: 2,
          example: [-1000000, 300000, 350000, 400000, 450000]
        },
        discountRate: {
          type: 'number',
          description: '折现率（小数形式，如0.1表示10%）',
          minimum: 0,
          maximum: 1,
          default: 0.08
        },
        periods: {
          type: 'number',
          description: '期数（用于fv/pv计算）',
          minimum: 1,
          default: 1
        },
        presentValue: {
          type: 'number',
          description: '现值（用于fv计算）',
          default: 0
        },
        futureValue: {
          type: 'number',
          description: '终值（用于pv计算）',
          default: 0
        },
        currency: {
          type: 'string',
          description: '货币单位',
          enum: ['CNY', 'USD', 'EUR', 'GBP'],
          default: 'CNY'
        }
      },
      required: ['calculationType']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        calculationType: { type: 'string' },
        result: { type: 'object' },
        currency: { type: 'string' },
        timestamp: { type: 'number' }
      }
    },
    examples: [
      {
        input: {
          calculationType: 'npv',
          cashFlows: [-1000000, 300000, 350000, 400000, 450000],
          discountRate: 0.1,
          currency: 'CNY'
        },
        output: {
          success: true,
          calculationType: 'npv',
          result: {
            npv: 169865.45,
            discountRate: '10%',
            periods: 5
          },
          currency: 'CNY'
        }
      }
    ]
  },

  real_estate_calculator: {
    name: 'real_estate_calculator',
    display_name: '房地产财务计算器 / Real Estate Financial Calculator',
    description: '计算房地产项目的IRR、NPV、现金流等财务指标',
    category: 'finance',
    parameters: {
      type: 'object',
      properties: {
        initialInvestment: {
          type: 'number',
          description: '初始投资金额',
          minimum: 0,
          example: 5000000
        },
        projectPeriod: {
          type: 'number',
          description: '项目周期（年）',
          minimum: 1,
          maximum: 50,
          default: 10
        },
        annualRevenue: {
          type: 'array',
          description: '各年度收入',
          items: { type: 'number', minimum: 0 },
          example: [800000, 900000, 1000000, 1100000, 1200000]
        },
        annualCosts: {
          type: 'array',
          description: '各年度成本',
          items: { type: 'number', minimum: 0 },
          example: [400000, 420000, 440000, 460000, 480000]
        },
        discountRate: {
          type: 'number',
          description: '折现率',
          minimum: 0,
          maximum: 1,
          default: 0.08
        },
        currency: {
          type: 'string',
          enum: ['CNY', 'USD'],
          default: 'CNY'
        }
      },
      required: ['initialInvestment']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        calculations: {
          type: 'object',
          properties: {
            npv: { type: 'number' },
            irr: { type: 'string' },
            roi: { type: 'string' },
            paybackPeriod: { type: 'string' },
            cashFlows: { type: 'array', items: { type: 'number' } },
            summary: { type: 'object' }
          }
        },
        currency: { type: 'string' }
      }
    }
  },

  budget_calculator: {
    name: 'budget_calculator',
    display_name: '预算计算器 / Budget Calculator',
    description: '计算和管理项目预算，支持成本分解、预算跟踪、差异分析',
    category: 'finance',
    parameters: {
      type: 'object',
      properties: {
        totalBudget: {
          type: 'number',
          description: '总预算',
          minimum: 0,
          example: 1000000
        },
        costCategories: {
          type: 'array',
          description: '成本类别',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '类别名称' },
              amount: { type: 'number', description: '预算金额', minimum: 0 }
            },
            required: ['name', 'amount']
          },
          minItems: 1
        },
        actualSpending: {
          type: 'array',
          description: '实际支出（与costCategories对应）',
          items: { type: 'number', minimum: 0 },
          default: []
        },
        currency: {
          type: 'string',
          enum: ['CNY', 'USD', 'EUR'],
          default: 'CNY'
        },
        trackingMode: {
          type: 'string',
          enum: ['realtime', 'daily', 'weekly', 'monthly'],
          default: 'realtime'
        }
      },
      required: ['totalBudget', 'costCategories']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        budget: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            allocated: { type: 'number' },
            spent: { type: 'number' },
            remaining: { type: 'number' },
            utilizationRate: { type: 'string' },
            categories: { type: 'array' },
            summary: { type: 'object' }
          }
        }
      }
    }
  },

  // ==================== CRM工具 ====================

  health_score_calculator: {
    name: 'health_score_calculator',
    display_name: '客户健康度评分器 / Customer Health Score Calculator',
    description: '计算客户健康度评分，预测续约风险和扩展机会',
    category: 'crm',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: '客户ID',
          minLength: 1
        },
        usageMetrics: {
          type: 'object',
          description: '使用指标',
          properties: {
            loginDays: { type: 'number', description: '月登录天数', minimum: 0, maximum: 31 },
            featureUsage: { type: 'number', description: '功能使用率(%)', minimum: 0, maximum: 100 }
          }
        },
        engagementMetrics: {
          type: 'object',
          description: '参与度指标',
          properties: {
            interactions: { type: 'number', description: '月互动次数', minimum: 0 },
            sessionDuration: { type: 'number', description: '平均会话时长(秒)', minimum: 0 }
          }
        },
        satisfactionMetrics: {
          type: 'object',
          description: '满意度指标',
          properties: {
            nps: { type: 'number', description: 'NPS评分', minimum: 0, maximum: 10 },
            csat: { type: 'number', description: 'CSAT评分', minimum: 0, maximum: 100 }
          }
        },
        scoringModel: {
          type: 'string',
          enum: ['weighted', 'balanced', 'custom'],
          default: 'weighted'
        }
      },
      required: ['customerId']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        healthScore: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            overallScore: { type: 'number', minimum: 0, maximum: 100 },
            scoreBreakdown: { type: 'object' },
            riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
            renewalProbability: { type: 'string' },
            opportunities: { type: 'array' },
            recommendations: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  },

  churn_predictor: {
    name: 'churn_predictor',
    display_name: '客户流失预测器 / Churn Predictor',
    description: '基于客户行为数据预测流失风险，提供挽留建议',
    category: 'crm',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: '客户ID',
          minLength: 1
        },
        behaviorData: {
          type: 'object',
          description: '行为数据',
          properties: {
            loginFrequency: { type: 'number', description: '月登录频率', minimum: 0 },
            featureUsage: { type: 'number', description: '功能使用率(%)', minimum: 0, maximum: 100 },
            supportTickets: { type: 'number', description: '支持工单数', minimum: 0 },
            paymentHistory: { type: 'string', enum: ['on-time', 'late', 'failed'], description: '付款历史' }
          }
        },
        historicalData: {
          type: 'object',
          description: '历史数据',
          properties: {
            avgMonthlyRevenue: { type: 'number', minimum: 0 },
            avgLifespan: { type: 'number', minimum: 0, description: '平均生命周期(月)' }
          }
        },
        modelType: {
          type: 'string',
          enum: ['ml', 'rule-based', 'hybrid'],
          default: 'ml'
        },
        predictionWindow: {
          type: 'string',
          pattern: '^\\d+days$',
          default: '90days'
        }
      },
      required: ['customerId', 'behaviorData']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        prediction: {
          type: 'object',
          properties: {
            customerId: { type: 'string' },
            churnScore: { type: 'number', minimum: 0, maximum: 100 },
            churnRisk: { type: 'string', enum: ['low', 'medium', 'high'] },
            churnProbability: { type: 'string' },
            keyIndicators: { type: 'object' },
            retentionActions: { type: 'array' },
            estimatedValue: { type: 'string' }
          }
        }
      }
    }
  },

  crm_integrator: {
    name: 'crm_integrator',
    display_name: 'CRM集成器 / CRM Integrator',
    description: '集成主流CRM系统（Salesforce、HubSpot、Zoho等），同步客户数据',
    category: 'crm',
    parameters: {
      type: 'object',
      properties: {
        crmSystem: {
          type: 'string',
          description: 'CRM系统名称',
          enum: ['salesforce', 'hubspot', 'zoho', 'dynamics']
        },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['connect', 'sync', 'query', 'disconnect']
        },
        credentials: {
          type: 'object',
          description: '认证凭据',
          properties: {
            apiKey: { type: 'string' },
            apiSecret: { type: 'string' },
            accessToken: { type: 'string' }
          }
        },
        syncData: {
          type: 'object',
          description: '同步数据配置',
          additionalProperties: true
        },
        syncInterval: {
          type: 'string',
          enum: ['5min', '15min', '30min', '1hour', 'manual'],
          default: '15min'
        }
      },
      required: ['crmSystem', 'action']
    },
    returns: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        crmSystem: { type: 'string' },
        action: { type: 'string' },
        result: { type: 'object' },
        syncInterval: { type: 'string' }
      }
    }
  },

  // ==================== 其他工具（简化定义）====================

  market_data_analyzer: {
    name: 'market_data_analyzer',
    display_name: '市场数据分析器 / Market Data Analyzer',
    category: 'analysis',
    parameters: {
      type: 'object',
      properties: {
        marketSegment: { type: 'string', description: '市场细分' },
        analysisType: { type: 'string', enum: ['basic', 'comprehensive'], default: 'comprehensive' },
        timeRange: { type: 'string', default: '1year' }
      },
      required: ['marketSegment']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, analysis: { type: 'object' } } }
  },

  stakeholder_analyzer: {
    name: 'stakeholder_analyzer',
    display_name: '利益相关者映射工具 / Stakeholder Mapping Tool',
    category: 'project',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        stakeholders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              role: { type: 'string' },
              power: { type: 'number', minimum: 0, maximum: 100 },
              interest: { type: 'number', minimum: 0, maximum: 100 }
            }
          }
        },
        matrixType: { type: 'string', enum: ['power-interest', 'influence-impact'], default: 'power-interest' }
      },
      required: ['projectId', 'stakeholders']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, analysis: { type: 'object' } } }
  },

  communication_planner: {
    name: 'communication_planner',
    display_name: '沟通计划工具 / Communication Planner',
    category: 'project',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        stakeholders: { type: 'array' },
        communicationTypes: { type: 'array', default: [] },
        templateType: { type: 'string', default: 'stakeholder-based' }
      },
      required: ['projectId', 'stakeholders']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, plan: { type: 'object' } } }
  },

  org_chart_generator: {
    name: 'org_chart_generator',
    display_name: '组织架构图生成器 / Organization Chart Generator',
    category: 'hr',
    parameters: {
      type: 'object',
      properties: {
        organizationData: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              title: { type: 'string' },
              department: { type: 'string' },
              level: { type: 'number' },
              managerId: { type: 'string', nullable: true }
            }
          }
        },
        chartStyle: { type: 'string', enum: ['hierarchical', 'matrix', 'flat'], default: 'hierarchical' },
        exportFormat: { type: 'string', enum: ['svg', 'png', 'json'], default: 'svg' }
      },
      required: ['organizationData']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, chart: { type: 'object' } } }
  },

  culture_analyzer: {
    name: 'culture_analyzer',
    display_name: '企业文化分析器 / Culture Analyzer',
    category: 'hr',
    parameters: {
      type: 'object',
      properties: {
        surveyData: { type: 'array' },
        frameworkType: { type: 'string', enum: ['competing-values', 'denison'], default: 'competing-values' },
        benchmarkData: { type: 'object', default: {} }
      },
      required: ['surveyData']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, analysis: { type: 'object' } } }
  },

  competency_framework: {
    name: 'competency_framework',
    display_name: '能力框架工具 / Competency Framework Tool',
    category: 'hr',
    parameters: {
      type: 'object',
      properties: {
        frameworkType: { type: 'string', enum: ['behavioral', 'functional', 'technical'], default: 'behavioral' },
        levelCount: { type: 'number', minimum: 3, maximum: 7, default: 5 },
        competencies: { type: 'array' },
        jobRole: { type: 'string' }
      },
      required: ['jobRole']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, framework: { type: 'object' } } }
  },

  readiness_assessor: {
    name: 'readiness_assessor',
    display_name: '变革准备度评估器 / Change Readiness Assessor',
    category: 'management',
    parameters: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' },
        changeInitiative: { type: 'string' },
        framework: { type: 'string', enum: ['ADKAR', 'Kotter', 'Lewin'], default: 'ADKAR' },
        surveyResponses: { type: 'array', default: [] }
      },
      required: ['changeInitiative']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, assessment: { type: 'object' } } }
  },

  event_timeline_generator: {
    name: 'event_timeline_generator',
    display_name: '活动时间线生成器 / Event Timeline Generator',
    category: 'event',
    parameters: {
      type: 'object',
      properties: {
        eventName: { type: 'string' },
        eventDate: { type: 'string', format: 'date' },
        preparationWeeks: { type: 'number', minimum: 1, maximum: 52, default: 12 },
        viewType: { type: 'string', enum: ['gantt', 'timeline', 'calendar'], default: 'gantt' }
      },
      required: ['eventName', 'eventDate']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, timeline: { type: 'object' } } }
  },

  press_release_generator: {
    name: 'press_release_generator',
    display_name: '新闻稿生成器 / Press Release Generator',
    category: 'marketing',
    parameters: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        subheadline: { type: 'string' },
        company: { type: 'string' },
        location: { type: 'string' },
        announcement: { type: 'string' },
        quotes: { type: 'array', default: [] },
        boilerplate: { type: 'string' },
        contactInfo: { type: 'string' },
        style: { type: 'string', enum: ['ap', 'chicago', 'apa'], default: 'ap' },
        language: { type: 'string', default: 'zh-CN' }
      },
      required: ['headline', 'announcement']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, pressRelease: { type: 'object' } } }
  },

  media_list_manager: {
    name: 'media_list_manager',
    display_name: '媒体列表管理器 / Media List Manager',
    category: 'marketing',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'segment', 'delete'] },
        mediaContact: { type: 'object' },
        tier: { type: 'string', enum: ['tier-1', 'tier-2', 'tier-3'] },
        category: { type: 'string' },
        filters: { type: 'object', default: {} }
      },
      required: ['action']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, result: { type: 'object' } } }
  },

  sentiment_analyzer: {
    name: 'sentiment_analyzer',
    display_name: '舆情分析器 / Sentiment Analyzer',
    category: 'marketing',
    parameters: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        sources: { type: 'string', enum: ['all', 'social', 'news', 'forums'], default: 'all' },
        timeRange: { type: 'string', default: '7days' },
        realtime: { type: 'boolean', default: true }
      },
      required: ['keyword']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, analysis: { type: 'object' } } }
  },

  risk_assessor: {
    name: 'risk_assessor',
    display_name: '审计风险评估器 / Audit Risk Assessor',
    category: 'audit',
    parameters: {
      type: 'object',
      properties: {
        auditArea: { type: 'string' },
        entityInfo: { type: 'object', default: {} },
        riskModel: { type: 'string', enum: ['inherent-control-detection', 'coso'], default: 'inherent-control-detection' }
      },
      required: ['auditArea']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, assessment: { type: 'object' } } }
  },

  control_evaluator: {
    name: 'control_evaluator',
    display_name: '内部控制评价器 / Control Effectiveness Evaluator',
    category: 'audit',
    parameters: {
      type: 'object',
      properties: {
        controlArea: { type: 'string' },
        controls: { type: 'array', default: [] },
        framework: { type: 'string', enum: ['COSO', 'COBIT'], default: 'COSO' },
        evaluationType: { type: 'string', enum: ['design', 'operating', 'both'], default: 'both' }
      },
      required: ['controlArea']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, evaluation: { type: 'object' } } }
  },

  evidence_documenter: {
    name: 'evidence_documenter',
    display_name: '证据记录器 / Evidence Documenter',
    category: 'audit',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'retrieve', 'list', 'delete'] },
        evidence: { type: 'object' },
        auditId: { type: 'string' },
        workpaperId: { type: 'string' },
        autoNumbering: { type: 'boolean', default: true },
        encryption: { type: 'boolean', default: true }
      },
      required: ['action', 'auditId']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, result: { type: 'object' } } }
  },

  code_generator: {
    name: 'code_generator',
    display_name: '代码生成器 / Code Generator',
    category: 'code',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['javascript', 'python', 'java', 'solidity', 'go', 'rust'] },
        codeType: { type: 'string', enum: ['function', 'class', 'module', 'contract'] },
        specification: { type: 'object' },
        outputFormat: { type: 'string', enum: ['formatted', 'minified'], default: 'formatted' }
      },
      required: ['language', 'codeType', 'specification']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, code: { type: 'object' } } }
  },

  simulation_runner: {
    name: 'simulation_runner',
    display_name: '模拟运行器 / Simulation Runner',
    category: 'analysis',
    parameters: {
      type: 'object',
      properties: {
        simulationType: { type: 'string', enum: ['monte-carlo', 'sensitivity', 'scenario'] },
        model: { type: 'string' },
        iterations: { type: 'number', minimum: 100, maximum: 100000, default: 10000 },
        variables: { type: 'object' },
        distributionType: { type: 'string', enum: ['normal', 'uniform', 'triangular'], default: 'normal' }
      },
      required: ['simulationType', 'model']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, simulation: { type: 'object' } } }
  },

  vendor_manager: {
    name: 'vendor_manager',
    display_name: '供应商管理器 / Vendor Manager',
    category: 'procurement',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'rate', 'evaluate', 'list'] },
        vendorId: { type: 'string' },
        vendorData: { type: 'object', default: {} },
        ratingSystem: { type: 'string', enum: ['5-star', '10-point', 'percentage'], default: '5-star' },
        autoReminder: { type: 'boolean', default: true }
      },
      required: ['action']
    },
    returns: { type: 'object', properties: { success: { type: 'boolean' }, result: { type: 'object' } } }
  }
};

module.exports = toolSchemas;
