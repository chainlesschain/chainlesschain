/**
 * 生产环境集成测试
 * 测试ToolManager在主进程环境中加载Additional Tools V3
 */

const { logger, createLogger } = require('../utils/logger.js');
const path = require('path');
const DatabaseManager = require('../database');
const ToolManager = require('./tool-manager');

// Mock FunctionCaller (模拟主进程中的FunctionCaller)
class MockFunctionCaller {
  constructor() {
    this.tools = new Map();
    this.registeredTools = [];
  }

  registerTool(name, handler, schema) {
    this.tools.set(name, { handler, schema });
    this.registeredTools.push(name);
    logger.info(`  [FunctionCaller] ✅ 注册工具: ${name}`);
  }

  unregisterTool(name) {
    this.tools.delete(name);
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  getAvailableTools() {
    return Array.from(this.tools.entries()).map(([name, { schema }]) => ({
      name,
      ...schema
    }));
  }

  async callTool(name, params) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`工具不存在: ${name}`);
    }
    return await tool.handler(params);
  }

  setToolManager(toolManager) {
    this.toolManager = toolManager;
    logger.info('[FunctionCaller] ToolManager引用已设置');
  }
}

class ProductionIntegrationTester {
  constructor() {
    this.db = null;
    this.functionCaller = null;
    this.toolManager = null;
  }

  /**
   * 初始化测试环境
   */
  async initialize() {
    try {
      logger.info('========================================');
      logger.info('  生产环境集成测试');
      logger.info('  模拟Electron主进程环境');
      logger.info('========================================\n');

      // 1. 初始化数据库
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../../data/chainlesschain.db');
      logger.info(`[Test] 数据库路径: ${dbPath}`);

      this.db = new DatabaseManager(dbPath, {
        encryptionEnabled: false,
      });

      await this.db.initialize();
      logger.info('[Test] ✅ 数据库连接成功\n');

      // 2. 初始化FunctionCaller (模拟主进程中的FunctionCaller)
      this.functionCaller = new MockFunctionCaller();
      logger.info('[Test] ✅ FunctionCaller初始化成功\n');

      // 3. 初始化ToolManager (这是关键测试点)
      logger.info('[Test] 开始初始化ToolManager...\n');
      this.toolManager = new ToolManager(this.db, this.functionCaller);

      await this.toolManager.initialize();

      logger.info('\n[Test] ✅ ToolManager初始化完成\n');

      return true;

    } catch (error) {
      logger.error('[Test] ❌ 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 验证V3工具是否正确加载
   */
  async verifyV3ToolsLoaded() {
    try {
      logger.info('========================================');
      logger.info('  验证V3工具加载状态');
      logger.info('========================================\n');

      // 1. 检查数据库中的V3工具
      const dbTools = await this.db.all(
        'SELECT id, name, display_name, handler_path FROM tools WHERE handler_path LIKE ? AND enabled = 1',
        ['%additional-tools-v3-handler%']
      );

      logger.info(`[Verify] 数据库中V3工具数量: ${dbTools.length}\n`);

      // 2. 检查FunctionCaller中的V3工具
      const fcToolNames = this.functionCaller.registeredTools;
      const v3InFC = fcToolNames.filter(name => {
        return dbTools.some(tool => tool.name === name);
      });

      logger.info(`[Verify] FunctionCaller中V3工具数量: ${v3InFC.length}`);
      logger.info(`[Verify] 注册成功率: ${(v3InFC.length / dbTools.length * 100).toFixed(1)}%\n`);

      // 3. 检查ToolManager缓存
      const cachedV3Tools = Array.from(this.toolManager.tools.values())
        .filter(tool => tool.handler_path && tool.handler_path.includes('additional-tools-v3-handler'));

      logger.info(`[Verify] ToolManager缓存中V3工具数量: ${cachedV3Tools.length}\n`);

      // 4. 按分类统计
      const toolsByCategory = {};
      dbTools.forEach(tool => {
        const category = tool.category || 'unknown';
        if (!toolsByCategory[category]) {
          toolsByCategory[category] = [];
        }
        toolsByCategory[category].push(tool.name);
      });

      logger.info('[Verify] V3工具分类统计:\n');
      Object.entries(toolsByCategory).forEach(([category, tools]) => {
        logger.info(`  ${category.toUpperCase()} (${tools.length}个):`);
        tools.forEach(tool => {
          const inFC = fcToolNames.includes(tool);
          const status = inFC ? '✅' : '❌';
          logger.info(`    ${status} ${tool}`);
        });
        logger.info('');
      });

      return {
        dbCount: dbTools.length,
        fcCount: v3InFC.length,
        cacheCount: cachedV3Tools.length,
        successRate: (v3InFC.length / dbTools.length * 100).toFixed(1) + '%'
      };

    } catch (error) {
      logger.error('[Verify] ❌ 验证失败:', error);
      throw error;
    }
  }

  /**
   * 测试工具调用
   */
  async testToolExecution() {
    try {
      logger.info('========================================');
      logger.info('  测试工具执行');
      logger.info('========================================\n');

      const testCases = [
        {
          name: 'contract_analyzer',
          params: {
            contractCode: 'pragma solidity ^0.8.0; contract Test {}',
            analysisDepth: 'basic',
            securityFocus: true
          }
        },
        {
          name: 'blockchain_query',
          params: {
            queryType: 'balance',
            address: '0x123',
            chain: 'ethereum'
          }
        },
        {
          name: 'financial_calculator',
          params: {
            calculationType: 'npv',
            cashFlows: [-1000, 300, 400, 500],
            discountRate: 0.1
          }
        }
      ];

      let passed = 0;
      let failed = 0;

      for (const testCase of testCases) {
        try {
          logger.info(`[Execute] 测试工具: ${testCase.name}`);

          if (!this.functionCaller.hasTool(testCase.name)) {
            logger.info(`  ⚠️  工具未在FunctionCaller中注册，跳过\n`);
            continue;
          }

          const startTime = Date.now();
          const result = await this.functionCaller.callTool(testCase.name, testCase.params);
          const duration = Date.now() - startTime;

          if (result && result.success) {
            logger.info(`  ✅ 执行成功 (${duration}ms)`);
            passed++;
          } else {
            logger.info(`  ❌ 执行失败: ${result ? result.error : 'No result'}`);
            failed++;
          }

        } catch (error) {
          logger.error(`  ❌ 执行异常: ${error.message}`);
          failed++;
        }

        logger.info('');
      }

      logger.info(`[Execute] 测试完成: 成功 ${passed} 个, 失败 ${failed} 个\n`);

      return { passed, failed, total: testCases.length };

    } catch (error) {
      logger.error('[Execute] ❌ 测试执行失败:', error);
      throw error;
    }
  }

  /**
   * 性能测试
   */
  async performanceTest() {
    try {
      logger.info('========================================');
      logger.info('  性能测试');
      logger.info('========================================\n');

      const testTool = 'financial_calculator';
      const iterations = 100;

      if (!this.functionCaller.hasTool(testTool)) {
        logger.info(`[Perf] 工具未注册，跳过性能测试\n`);
        return;
      }

      logger.info(`[Perf] 测试工具: ${testTool}`);
      logger.info(`[Perf] 迭代次数: ${iterations}\n`);

      const durations = [];
      const params = {
        calculationType: 'npv',
        cashFlows: [-1000, 300, 400, 500],
        discountRate: 0.1
      };

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now();
        await this.functionCaller.callTool(testTool, params);
        const duration = Date.now() - startTime;
        durations.push(duration);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);

      logger.info(`[Perf] 平均执行时间: ${avgDuration.toFixed(2)}ms`);
      logger.info(`[Perf] 最快: ${minDuration}ms`);
      logger.info(`[Perf] 最慢: ${maxDuration}ms`);
      logger.info(`[Perf] 吞吐量: ${(1000 / avgDuration).toFixed(2)} 次/秒\n`);

      return {
        avgDuration,
        minDuration,
        maxDuration,
        throughput: (1000 / avgDuration).toFixed(2)
      };

    } catch (error) {
      logger.error('[Perf] ❌ 性能测试失败:', error);
    }
  }

  /**
   * 生成最终报告
   */
  generateReport(verifyResult, executeResult, perfResult) {
    logger.info('\n========================================');
    logger.info('  集成测试报告');
    logger.info('========================================\n');

    logger.info('【加载状态】');
    logger.info(`  数据库工具数: ${verifyResult.dbCount}`);
    logger.info(`  FunctionCaller注册数: ${verifyResult.fcCount}`);
    logger.info(`  ToolManager缓存数: ${verifyResult.cacheCount}`);
    logger.info(`  注册成功率: ${verifyResult.successRate}`);

    if (executeResult) {
      logger.info('\n【功能测试】');
      logger.info(`  总测试数: ${executeResult.total}`);
      logger.info(`  成功: ${executeResult.passed}`);
      logger.info(`  失败: ${executeResult.failed}`);
      logger.info(`  成功率: ${(executeResult.passed / executeResult.total * 100).toFixed(1)}%`);
    }

    if (perfResult) {
      logger.info('\n【性能指标】');
      logger.info(`  平均响应时间: ${perfResult.avgDuration}ms`);
      logger.info(`  吞吐量: ${perfResult.throughput} 次/秒`);
    }

    logger.info('\n【结论】');
    const allPassed = verifyResult.fcCount === verifyResult.dbCount &&
                      (!executeResult || executeResult.failed === 0);

    if (allPassed) {
      logger.info('  ✅ 生产环境集成成功！所有V3工具已正确加载并可正常使用。');
    } else {
      logger.info('  ⚠️  存在部分问题，请检查上述报告。');
    }

    logger.info('\n========================================\n');

    return allPassed;
  }

  /**
   * 清理资源
   */
  async cleanup() {
    try {
      if (this.db && this.db.db) {
        await this.db.db.close();
        logger.info('[Test] 数据库连接已关闭');
      }
    } catch (error) {
      logger.error('[Test] 清理失败:', error);
    }
  }

  /**
   * 运行完整测试流程
   */
  async run() {
    try {
      // 1. 初始化
      await this.initialize();

      // 2. 验证加载状态
      const verifyResult = await this.verifyV3ToolsLoaded();

      // 3. 测试工具执行
      const executeResult = await this.testToolExecution();

      // 4. 性能测试
      const perfResult = await this.performanceTest();

      // 5. 生成报告
      const success = this.generateReport(verifyResult, executeResult, perfResult);

      return success;

    } catch (error) {
      logger.error('\n[Test] 测试失败:', error);
      return false;
    } finally {
      await this.cleanup();
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const tester = new ProductionIntegrationTester();
  tester.run()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      logger.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = ProductionIntegrationTester;
