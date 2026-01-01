/**
 * 测试Additional Tools V3 Handlers
 * 测试各个工具的Handler执行功能
 */

const path = require('path');
const AdditionalToolsV3Handler = require('./additional-tools-v3-handler');

class HandlerTester {
  constructor() {
    this.handler = null;
    this.testResults = [];
  }

  /**
   * 初始化
   */
  initialize() {
    console.log('========================================');
    console.log('  Handler功能测试');
    console.log('  测试29个工具的Handler执行');
    console.log('========================================\n');

    const workDir = path.join(__dirname, '../../../../data/workspace/test');
    this.handler = new AdditionalToolsV3Handler({ workDir });
    console.log(`[Test] Handler初始化成功 (workDir: ${workDir})\n`);
  }

  /**
   * 测试单个工具
   */
  async testTool(toolName, params) {
    const methodName = `tool_${toolName}`;
    const startTime = Date.now();

    try {
      console.log(`\n[Test] 测试工具: ${toolName}`);
      console.log(`[Test] 参数: ${JSON.stringify(params, null, 2)}`);

      if (typeof this.handler[methodName] !== 'function') {
        throw new Error(`Handler方法不存在: ${methodName}`);
      }

      const result = await this.handler[methodName](params);
      const duration = Date.now() - startTime;

      console.log(`[Test] ✅ 执行成功 (${duration}ms)`);
      console.log(`[Test] 结果: ${JSON.stringify(result, null, 2).substring(0, 500)}...`);

      this.testResults.push({
        tool: toolName,
        success: true,
        duration,
        result
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[Test] ❌ 执行失败 (${duration}ms):`, error.message);

      this.testResults.push({
        tool: toolName,
        success: false,
        duration,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('[Test] ===== 开始测试 =====\n');

    // 1. 区块链工具测试
    console.log('\n========== 区块链工具 ==========');

    await this.testTool('contract_analyzer', {
      contractCode: `
        pragma solidity ^0.8.0;
        contract SimpleStorage {
          uint256 value;
          function setValue(uint256 _value) public {
            value = _value;
          }
          function getValue() public view returns (uint256) {
            return value;
          }
        }
      `,
      analysisDepth: 'comprehensive',
      securityFocus: true
    });

    await this.testTool('blockchain_query', {
      queryType: 'balance',
      address: '0x1234567890123456789012345678901234567890',
      chain: 'ethereum'
    });

    await this.testTool('tokenomics_simulator', {
      initialSupply: 1000000,
      maxSupply: 10000000,
      initialPrice: 0.1,
      inflationRate: 5,
      burnRate: 2,
      simulationPeriod: '3years',
      iterations: 100
    });

    // 2. 法律工具测试
    console.log('\n========== 法律工具 ==========');

    await this.testTool('legal_template_generator', {
      documentType: 'nda',
      jurisdiction: 'CN',
      language: 'zh-CN',
      parties: ['甲方公司', '乙方公司'],
      terms: {
        purpose: '技术合作',
        confidentialityPeriod: '五年'
      }
    });

    await this.testTool('claim_analyzer', {
      claimText: '一种数据处理方法，其特征在于...',
      analysisType: 'comprehensive',
      priorArt: []
    });

    // 3. 财务工具测试
    console.log('\n========== 财务工具 ==========');

    await this.testTool('real_estate_calculator', {
      initialInvestment: 5000000,
      projectPeriod: 5,
      annualRevenue: [800000, 900000, 1000000, 1100000, 1200000],
      annualCosts: [400000, 420000, 440000, 460000, 480000],
      discountRate: 0.08,
      currency: 'CNY'
    });

    await this.testTool('financial_calculator', {
      calculationType: 'npv',
      cashFlows: [-1000000, 300000, 350000, 400000, 450000],
      discountRate: 0.1,
      currency: 'CNY'
    });

    await this.testTool('budget_calculator', {
      totalBudget: 1000000,
      costCategories: [
        { name: '人力成本', amount: 500000 },
        { name: '设备采购', amount: 300000 },
        { name: '市场推广', amount: 200000 }
      ],
      actualSpending: [480000, 320000, 180000],
      currency: 'CNY'
    });

    // 4. CRM工具测试
    console.log('\n========== CRM工具 ==========');

    await this.testTool('health_score_calculator', {
      customerId: 'CUST001',
      usageMetrics: { loginDays: 25, featureUsage: 75 },
      engagementMetrics: { interactions: 15, sessionDuration: 3600 },
      satisfactionMetrics: { nps: 9, csat: 85 },
      scoringModel: 'weighted'
    });

    await this.testTool('churn_predictor', {
      customerId: 'CUST002',
      behaviorData: {
        loginFrequency: 3,
        featureUsage: 25,
        supportTickets: 6,
        paymentHistory: 'late'
      },
      historicalData: {
        avgMonthlyRevenue: 5000,
        avgLifespan: 18
      },
      predictionWindow: '90days'
    });

    await this.testTool('crm_integrator', {
      crmSystem: 'salesforce',
      action: 'connect',
      credentials: { apiKey: 'test_key' }
    });

    // 5. 项目管理工具测试
    console.log('\n========== 项目管理工具 ==========');

    await this.testTool('stakeholder_analyzer', {
      projectId: 'PRJ001',
      stakeholders: [
        { name: '张总', role: 'CEO', power: 90, interest: 95 },
        { name: '李经理', role: 'PM', power: 60, interest: 85 },
        { name: '王工程师', role: 'Developer', power: 30, interest: 70 }
      ],
      matrixType: 'power-interest'
    });

    await this.testTool('communication_planner', {
      projectId: 'PRJ001',
      stakeholders: [
        { name: '高层管理', frequency: 'monthly', channel: 'presentation' },
        { name: '核心团队', frequency: 'weekly', channel: 'meeting' },
        { name: '外部合作方', frequency: 'biweekly', channel: 'email' }
      ]
    });

    // 6. HR工具测试
    console.log('\n========== HR工具 ==========');

    await this.testTool('org_chart_generator', {
      organizationData: [
        { id: 'EMP001', name: '张总', title: 'CEO', department: '管理层', level: 0 },
        { id: 'EMP002', name: '李总监', title: 'CTO', department: '技术部', level: 1, managerId: 'EMP001' },
        { id: 'EMP003', name: '王经理', title: '研发经理', department: '技术部', level: 2, managerId: 'EMP002' }
      ],
      chartStyle: 'hierarchical',
      exportFormat: 'svg'
    });

    await this.testTool('culture_analyzer', {
      surveyData: [
        { dimension: 'clan', score: 75 },
        { dimension: 'adhocracy', score: 65 },
        { dimension: 'market', score: 70 },
        { dimension: 'hierarchy', score: 60 }
      ],
      frameworkType: 'competing-values'
    });

    await this.testTool('competency_framework', {
      frameworkType: 'behavioral',
      levelCount: 5,
      jobRole: '软件工程师',
      competencies: [
        { name: '技术能力', category: 'technical', weightage: 40 },
        { name: '沟通协作', category: 'soft', weightage: 30 },
        { name: '问题解决', category: 'core', weightage: 30 }
      ]
    });

    // 7. 变革管理工具测试
    console.log('\n========== 变革管理工具 ==========');

    await this.testTool('readiness_assessor', {
      organizationId: 'ORG001',
      changeInitiative: '数字化转型项目',
      framework: 'ADKAR',
      surveyResponses: [
        { stage: 'awareness', score: 75 },
        { stage: 'desire', score: 60 },
        { stage: 'knowledge', score: 55 },
        { stage: 'ability', score: 50 },
        { stage: 'reinforcement', score: 45 }
      ]
    });

    // 8. 活动策划工具测试
    console.log('\n========== 活动策划工具 ==========');

    await this.testTool('event_timeline_generator', {
      eventName: '2026年技术大会',
      eventDate: '2026-06-15',
      preparationWeeks: 12,
      viewType: 'gantt'
    });

    // 9. 营销工具测试
    console.log('\n========== 营销工具 ==========');

    await this.testTool('press_release_generator', {
      headline: '科技公司发布创新产品',
      subheadline: '引领行业数字化转型',
      company: 'ChainlessChain',
      location: '北京',
      announcement: '今日，ChainlessChain正式发布...',
      quotes: [
        { text: '这是行业的重大突破', author: '张总', title: 'CEO' }
      ],
      boilerplate: 'ChainlessChain是一家专注于区块链技术的创新公司',
      contactInfo: 'contact@example.com',
      style: 'ap',
      language: 'zh-CN'
    });

    await this.testTool('media_list_manager', {
      action: 'list',
      filters: { category: 'tech' }
    });

    await this.testTool('sentiment_analyzer', {
      keyword: 'ChainlessChain',
      sources: 'all',
      timeRange: '7days',
      realtime: true
    });

    // 10. 审计工具测试
    console.log('\n========== 审计工具 ==========');

    await this.testTool('risk_assessor', {
      auditArea: '财务报表',
      entityInfo: {
        industry: '科技',
        revenue: 10000000,
        complexity: 'medium'
      },
      riskModel: 'inherent-control-detection'
    });

    await this.testTool('control_evaluator', {
      controlArea: '销售与收款',
      controls: [
        { id: 'CTRL001', name: '销售订单审批' },
        { id: 'CTRL002', name: '信用额度检查' },
        { id: 'CTRL003', name: '收款确认' }
      ],
      framework: 'COSO',
      evaluationType: 'both'
    });

    await this.testTool('evidence_documenter', {
      action: 'create',
      auditId: 'AUD2026001',
      evidence: {
        type: 'document',
        description: '银行对账单',
        source: '中国银行',
        date: '2025-12-31'
      },
      autoNumbering: true,
      encryption: true
    });

    // 11. 代码工具测试
    console.log('\n========== 代码工具 ==========');

    await this.testTool('code_generator', {
      language: 'javascript',
      codeType: 'function',
      specification: {
        name: 'calculateTotal',
        description: 'Calculate total amount',
        params: 'items',
        returnValue: 'total'
      },
      outputFormat: 'formatted'
    });

    // 12. 模拟工具测试
    console.log('\n========== 模拟工具 ==========');

    await this.testTool('simulation_runner', {
      simulationType: 'monte-carlo',
      model: 'revenue-projection',
      iterations: 1000,
      variables: {
        price: { mean: 100, stdDev: 10 },
        quantity: { mean: 1000, stdDev: 150 }
      },
      distributionType: 'normal'
    });

    // 13. 采购工具测试
    console.log('\n========== 采购工具 ==========');

    await this.testTool('vendor_manager', {
      action: 'evaluate',
      vendorId: 'VND001',
      ratingSystem: '5-star'
    });

    // 14. 市场分析工具测试
    console.log('\n========== 市场分析工具 ==========');

    await this.testTool('market_data_analyzer', {
      marketSegment: '人工智能软件',
      analysisType: 'comprehensive',
      timeRange: '1year'
    });
  }

  /**
   * 生成测试报告
   */
  generateReport() {
    console.log('\n\n========================================');
    console.log('  测试报告');
    console.log('========================================\n');

    const totalTests = this.testResults.length;
    const successTests = this.testResults.filter(r => r.success).length;
    const failedTests = this.testResults.filter(r => !r.success).length;
    const avgDuration = this.testResults.reduce((sum, r) => sum + r.duration, 0) / totalTests;

    console.log(`总测试数: ${totalTests}`);
    console.log(`成功: ${successTests} (${(successTests / totalTests * 100).toFixed(1)}%)`);
    console.log(`失败: ${failedTests} (${(failedTests / totalTests * 100).toFixed(1)}%)`);
    console.log(`平均执行时间: ${avgDuration.toFixed(0)}ms`);

    if (failedTests > 0) {
      console.log('\n失败的测试:');
      this.testResults
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`  ❌ ${r.tool}: ${r.error}`);
        });
    }

    console.log('\n执行时间统计:');
    const sortedByDuration = [...this.testResults]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);

    sortedByDuration.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.tool}: ${r.duration}ms`);
    });

    console.log('\n========================================\n');

    return {
      total: totalTests,
      success: successTests,
      failed: failedTests,
      avgDuration,
      successRate: (successTests / totalTests * 100).toFixed(1) + '%'
    };
  }

  /**
   * 运行测试流程
   */
  async run() {
    try {
      this.initialize();
      await this.runAllTests();
      const report = this.generateReport();

      return report;

    } catch (error) {
      console.error('\n[Test] 测试过程中发生错误:', error);
      this.generateReport();
      throw error;
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const tester = new HandlerTester();
  tester.run()
    .then(report => {
      const success = report.failed === 0;
      console.log(`\n测试${success ? '全部通过' : '部分失败'}! 成功率: ${report.successRate}`);
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('测试失败:', error);
      process.exit(1);
    });
}

module.exports = HandlerTester;
