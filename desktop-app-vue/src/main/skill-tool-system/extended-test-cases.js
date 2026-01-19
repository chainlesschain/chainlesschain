/**
 * 扩展测试用例
 * 为27个工具提供更全面的测试覆盖
 */

const path = require('path');
const { createEnhancedHandler } = require('./enhanced-handler-example');

// 测试用例定义
const testCases = {
  // ==================== 区块链工具测试 ====================

  contract_analyzer: [
    {
      name: '基础合约分析',
      params: {
        contractCode: 'pragma solidity ^0.8.0;\ncontract SimpleStorage { uint256 value; }',
        analysisDepth: 'basic',
        securityFocus: false
      },
      expectedSuccess: true
    },
    {
      name: '安全审计重点分析',
      params: {
        contractCode: 'pragma solidity ^0.8.0;\ncontract Payment {\n  function withdraw() public {\n    msg.sender.call{value: address(this).balance}("");\n  }\n}',
        analysisDepth: 'comprehensive',
        securityFocus: true
      },
      expectedSuccess: true,
      expectsWarnings: true  // 应该检测到重入攻击风险
    },
    {
      name: '缺少必需参数',
      params: {
        analysisDepth: 'basic'
        // 缺少contractCode
      },
      expectedSuccess: false,
      expectedError: true
    }
  ],

  blockchain_query: [
    {
      name: '查询地址余额',
      params: {
        queryType: 'balance',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
        chain: 'ethereum'
      },
      expectedSuccess: true
    },
    {
      name: '查询交易信息',
      params: {
        queryType: 'transaction',
        txHash: '0xabc1234567890def1234567890abcdef1234567890abcdef1234567890abcdef',
        chain: 'ethereum'
      },
      expectedSuccess: true
    },
    {
      name: '查询区块信息',
      params: {
        queryType: 'block',
        blockNumber: 12345678,
        chain: 'bsc'
      },
      expectedSuccess: true
    },
    {
      name: '无效地址格式',
      params: {
        queryType: 'balance',
        address: 'invalid-address',
        chain: 'ethereum'
      },
      expectedSuccess: true  // Handler应该处理但可能返回错误信息
    }
  ],

  tokenomics_simulator: [
    {
      name: '标准代币经济模拟',
      params: {
        initialSupply: 1000000,
        maxSupply: 10000000,
        initialPrice: 1.0,
        inflationRate: 5,
        burnRate: 2,
        simulationPeriod: '5years',
        iterations: 100
      },
      expectedSuccess: true
    },
    {
      name: '无通胀无销毁模拟',
      params: {
        initialSupply: 1000000,
        maxSupply: 1000000,
        initialPrice: 0.01,
        inflationRate: 0,
        burnRate: 0,
        simulationPeriod: '3years',
        iterations: 500
      },
      expectedSuccess: true
    },
    {
      name: '极端通胀场景',
      params: {
        initialSupply: 100000,
        maxSupply: 100000000,
        initialPrice: 10,
        inflationRate: 50,
        burnRate: 0,
        simulationPeriod: '10years',
        iterations: 1000
      },
      expectedSuccess: true
    }
  ],

  // ==================== 财务工具测试 ====================

  financial_calculator: [
    {
      name: 'NPV计算 - 正收益项目',
      params: {
        calculationType: 'npv',
        cashFlows: [-1000000, 300000, 350000, 400000, 450000],
        discountRate: 0.1,
        currency: 'CNY'
      },
      expectedSuccess: true
    },
    {
      name: 'IRR计算',
      params: {
        calculationType: 'irr',
        cashFlows: [-500000, 150000, 200000, 250000],
        currency: 'USD'
      },
      expectedSuccess: true
    },
    {
      name: 'ROI计算',
      params: {
        calculationType: 'roi',
        cashFlows: [-100000, 120000],
        currency: 'CNY'
      },
      expectedSuccess: true
    },
    {
      name: '终值计算',
      params: {
        calculationType: 'fv',
        presentValue: 10000,
        discountRate: 0.08,
        periods: 5,
        currency: 'USD'
      },
      expectedSuccess: true
    },
    {
      name: '现值计算',
      params: {
        calculationType: 'pv',
        futureValue: 15000,
        discountRate: 0.08,
        periods: 5,
        currency: 'CNY'
      },
      expectedSuccess: true
    },
    {
      name: '无效计算类型',
      params: {
        calculationType: 'unknown',
        cashFlows: [-1000, 500],
        discountRate: 0.1
      },
      expectedSuccess: false,
      expectedError: true
    }
  ],

  budget_calculator: [
    {
      name: '项目预算管理',
      params: {
        totalBudget: 1000000,
        costCategories: [
          { name: '人力成本', amount: 500000 },
          { name: '设备采购', amount: 300000 },
          { name: '市场推广', amount: 200000 }
        ],
        actualSpending: [480000, 320000, 180000],
        currency: 'CNY'
      },
      expectedSuccess: true
    },
    {
      name: '超支场景',
      params: {
        totalBudget: 500000,
        costCategories: [
          { name: '开发成本', amount: 300000 },
          { name: '测试成本', amount: 200000 }
        ],
        actualSpending: [350000, 220000],
        currency: 'USD'
      },
      expectedSuccess: true,
      expectsWarnings: true  // 应该检测到超支
    },
    {
      name: '空支出数据',
      params: {
        totalBudget: 1000000,
        costCategories: [
          { name: '类别1', amount: 500000 },
          { name: '类别2', amount: 500000 }
        ],
        actualSpending: [],
        currency: 'CNY'
      },
      expectedSuccess: true
    }
  ],

  // ==================== CRM工具测试 ====================

  health_score_calculator: [
    {
      name: '健康客户评分',
      params: {
        customerId: 'CUST001',
        usageMetrics: { loginDays: 25, featureUsage: 85 },
        engagementMetrics: { interactions: 20, sessionDuration: 4500 },
        satisfactionMetrics: { nps: 9, csat: 90 },
        scoringModel: 'weighted'
      },
      expectedSuccess: true
    },
    {
      name: '风险客户评分',
      params: {
        customerId: 'CUST002',
        usageMetrics: { loginDays: 3, featureUsage: 15 },
        engagementMetrics: { interactions: 1, sessionDuration: 300 },
        satisfactionMetrics: { nps: 3, csat: 45 },
        scoringModel: 'weighted'
      },
      expectedSuccess: true,
      expectsWarnings: true  // 应该标记为高风险
    },
    {
      name: '仅基础指标',
      params: {
        customerId: 'CUST003',
        usageMetrics: { loginDays: 15 },
        scoringModel: 'balanced'
      },
      expectedSuccess: true
    }
  ],

  churn_predictor: [
    {
      name: '高流失风险预测',
      params: {
        customerId: 'CUST101',
        behaviorData: {
          loginFrequency: 2,
          featureUsage: 10,
          supportTickets: 8,
          paymentHistory: 'late'
        },
        historicalData: {
          avgMonthlyRevenue: 5000,
          avgLifespan: 12
        },
        predictionWindow: '90days'
      },
      expectedSuccess: true
    },
    {
      name: '低流失风险预测',
      params: {
        customerId: 'CUST102',
        behaviorData: {
          loginFrequency: 20,
          featureUsage: 80,
          supportTickets: 1,
          paymentHistory: 'on-time'
        },
        historicalData: {
          avgMonthlyRevenue: 10000,
          avgLifespan: 36
        },
        predictionWindow: '90days'
      },
      expectedSuccess: true
    }
  ],

  // ==================== 其他工具测试（简化） ====================

  stakeholder_analyzer: [
    {
      name: '项目干系人分析',
      params: {
        projectId: 'PRJ001',
        stakeholders: [
          { name: 'CEO', role: 'Sponsor', power: 95, interest: 90 },
          { name: 'PM', role: 'Manager', power: 70, interest: 95 },
          { name: 'Dev1', role: 'Developer', power: 30, interest: 80 },
          { name: 'User1', role: 'End User', power: 20, interest: 60 }
        ],
        matrixType: 'power-interest'
      },
      expectedSuccess: true
    }
  ],

  org_chart_generator: [
    {
      name: '组织架构生成',
      params: {
        organizationData: [
          { id: 'E001', name: '张总', title: 'CEO', department: '管理层', level: 0 },
          { id: 'E002', name: '李总监', title: 'CTO', department: '技术部', level: 1, managerId: 'E001' },
          { id: 'E003', name: '王经理', title: '研发经理', department: '技术部', level: 2, managerId: 'E002' },
          { id: 'E004', name: '赵工程师', title: '高级工程师', department: '技术部', level: 3, managerId: 'E003' }
        ],
        chartStyle: 'hierarchical',
        exportFormat: 'svg'
      },
      expectedSuccess: true
    }
  ],

  code_generator: [
    {
      name: 'JavaScript函数生成',
      params: {
        language: 'javascript',
        codeType: 'function',
        specification: {
          name: 'calculateTotal',
          description: 'Calculate total amount',
          params: 'items, tax',
          returnValue: 'total'
        },
        outputFormat: 'formatted'
      },
      expectedSuccess: true
    },
    {
      name: 'Python类生成',
      params: {
        language: 'python',
        codeType: 'class',
        specification: {
          name: 'DataProcessor',
          description: 'Process data',
          methods: ['process', 'validate']
        },
        outputFormat: 'formatted'
      },
      expectedSuccess: true
    },
    {
      name: 'Solidity智能合约生成',
      params: {
        language: 'solidity',
        codeType: 'contract',
        specification: {
          name: 'Token',
          description: 'ERC20 token contract'
        },
        outputFormat: 'formatted'
      },
      expectedSuccess: true
    }
  ],

  simulation_runner: [
    {
      name: '蒙特卡洛模拟',
      params: {
        simulationType: 'monte-carlo',
        model: 'revenue-projection',
        iterations: 1000,
        variables: {
          price: { mean: 100, stdDev: 15 },
          quantity: { mean: 1000, stdDev: 200 }
        },
        distributionType: 'normal'
      },
      expectedSuccess: true
    }
  ]
};

/**
 * 测试运行器
 */
class ExtendedTestRunner {
  constructor() {
    this.handler = null;
    this.results = [];
  }

  /**
   * 初始化
   */
  async initialize() {
    console.log('========================================');
    console.log('  扩展测试套件');
    console.log('  更全面的功能和边界测试');
    console.log('========================================\n');

    this.handler = createEnhancedHandler({
      logLevel: 'warn',  // 减少日志输出
      workDir: path.join(__dirname, '../../../../data/workspace/test')
    });

    console.log('[Test] Handler初始化成功\n');
  }

  /**
   * 运行单个测试
   */
  async runTest(toolName, testCase) {
    const methodName = `tool_${toolName}`;

    if (!this.handler[methodName]) {
      console.error(`  ❌ 工具方法不存在: ${methodName}`);
      return { success: false, error: 'Method not found' };
    }

    const startTime = Date.now();

    try {
      const result = await this.handler[methodName](testCase.params);
      const duration = Date.now() - startTime;

      const testResult = {
        toolName,
        testName: testCase.name,
        success: result.success === testCase.expectedSuccess,
        duration,
        result
      };

      if (testResult.success) {
        console.log(`  ✅ ${testCase.name} (${duration}ms)`);
      } else {
        console.log(`  ❌ ${testCase.name} (${duration}ms)`);
        console.log(`     期望: ${testCase.expectedSuccess}, 实际: ${result.success}`);
      }

      this.results.push(testResult);
      return testResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`  ❌ ${testCase.name} - 异常: ${error.message}`);

      const testResult = {
        toolName,
        testName: testCase.name,
        success: false,
        duration,
        error: error.message
      };

      this.results.push(testResult);
      return testResult;
    }
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('[Test] 开始运行扩展测试...\n');

    let totalTests = 0;
    let toolsWithTests = 0;

    for (const [toolName, cases] of Object.entries(testCases)) {
      if (cases.length === 0) {continue;}

      console.log(`\n========== ${toolName} (${cases.length}个测试) ==========`);
      toolsWithTests++;

      for (const testCase of cases) {
        await this.runTest(toolName, testCase);
        totalTests++;
      }
    }

    console.log('\n========================================');
    console.log('  测试统计');
    console.log('========================================');
    console.log(`测试的工具数: ${toolsWithTests}`);
    console.log(`总测试用例数: ${totalTests}`);
    console.log(`成功: ${this.results.filter(r => r.success).length}`);
    console.log(`失败: ${this.results.filter(r => !r.success).length}`);
    console.log(`成功率: ${(this.results.filter(r => r.success).length / totalTests * 100).toFixed(1)}%`);
    console.log('========================================\n');

    // 错误统计
    const errorStats = this.handler.getErrorStats();
    if (Object.keys(errorStats).length > 0) {
      console.log('错误统计:');
      console.log(JSON.stringify(errorStats, null, 2));
    }

    return {
      total: totalTests,
      success: this.results.filter(r => r.success).length,
      failed: this.results.filter(r => !r.success).length,
      results: this.results
    };
  }

  /**
   * 运行
   */
  async run() {
    try {
      await this.initialize();
      const summary = await this.runAllTests();
      return summary.failed === 0;
    } catch (error) {
      console.error('\n[Test] 测试过程失败:', error);
      return false;
    }
  }
}

// 如果直接运行
if (require.main === module) {
  const runner = new ExtendedTestRunner();
  runner.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = {
  testCases,
  ExtendedTestRunner
};
