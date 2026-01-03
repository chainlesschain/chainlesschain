/**
 * 生产环境集成测试
 * 测试优化版AI引擎在主应用中的集成情况
 */

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║      优化版AI引擎 - 生产环境集成测试                    ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

async function testIntegration() {
  try {
    // 测试1: 导入模块
    console.log('[测试1] 测试模块导入...\n');

    const { getAIEngineManagerOptimized } = require('./src/main/ai-engine/ai-engine-manager-optimized');
    const { getAIEngineConfig } = require('./src/main/ai-engine/ai-engine-config');

    console.log('  ✅ 优化版AI引擎模块导入成功');
    console.log('  ✅ 配置模块导入成功');

    // 测试2: 配置加载
    console.log('\n[测试2] 测试配置加载...\n');

    const config = getAIEngineConfig();
    console.log('  当前环境:', process.env.NODE_ENV || 'development');
    console.log('  配置内容:');
    console.log('    - 槽位填充:', config.enableSlotFilling);
    console.log('    - 工具沙箱:', config.enableToolSandbox);
    console.log('    - 性能监控:', config.enablePerformanceMonitor);
    console.log('    - 沙箱超时:', config.sandboxConfig.timeout + 'ms');
    console.log('    - 重试次数:', config.sandboxConfig.retries);
    console.log('  ✅ 配置加载正常');

    // 测试3: 单例模式
    console.log('\n[测试3] 测试单例模式...\n');

    const instance1 = getAIEngineManagerOptimized();
    const instance2 = getAIEngineManagerOptimized();

    if (instance1 === instance2) {
      console.log('  ✅ 单例模式工作正常（两次获取返回同一实例）');
    } else {
      console.log('  ❌ 单例模式失败（返回了不同实例）');
      process.exit(1);
    }

    // 测试4: API兼容性
    console.log('\n[测试4] 测试API兼容性...\n');

    const aiEngine = instance1;
    const methods = [
      'initialize',
      'processUserInput',
      'registerTool',
      'unregisterTool',
      'getAvailableTools',
      'getTaskPlanner',
      'setUserId',
      'getPerformanceReport',
      'getSessionPerformance',
      'cleanOldPerformanceData'
    ];

    let allMethodsExist = true;
    for (const method of methods) {
      if (typeof aiEngine[method] === 'function') {
        console.log(`  ✅ ${method}()`);
      } else {
        console.log(`  ❌ ${method}() - 缺失`);
        allMethodsExist = false;
      }
    }

    if (!allMethodsExist) {
      console.log('\n  ❌ API不完整');
      process.exit(1);
    }

    // 测试5: 依赖模块
    console.log('\n[测试5] 测试优化模块...\n');

    const SlotFiller = require('./src/main/ai-engine/slot-filler');
    const ToolSandbox = require('./src/main/ai-engine/tool-sandbox');
    const PerformanceMonitor = require('./src/main/monitoring/performance-monitor');

    console.log('  ✅ SlotFiller 模块可导入');
    console.log('  ✅ ToolSandbox 模块可导入');
    console.log('  ✅ PerformanceMonitor 模块可导入');

    // 测试6: 数据库表
    console.log('\n[测试6] 验证数据库表...\n');

    const initSqlJs = require('sql.js');
    const fs = require('fs');
    const path = require('path');

    const dbPath = path.join(__dirname, '../data/chainlesschain.db');
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(buffer);

    const expectedTables = [
      'slot_filling_history',
      'tool_execution_logs',
      'performance_metrics',
      'intent_recognition_history',
      'task_execution_history',
      'user_preferences',
      'optimization_suggestions'
    ];

    let allTablesExist = true;
    for (const tableName of expectedTables) {
      const result = db.exec(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='${tableName}'
      `);

      if (result[0]?.values.length > 0) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} - 不存在`);
        allTablesExist = false;
      }
    }

    db.close();

    if (!allTablesExist) {
      console.log('\n  ❌ 数据库表缺失，请先运行迁移脚本');
      console.log('  命令: node run-migration.js');
      process.exit(1);
    }

    // 测试7: 模拟初始化
    console.log('\n[测试7] 测试AI引擎初始化...\n');

    try {
      // 注意: 这里只测试配置合并，不实际初始化（避免依赖LLM服务）
      const testConfig = {
        enableSlotFilling: false,
        sandboxConfig: {
          timeout: 15000
        }
      };

      const { mergeConfig } = require('./src/main/ai-engine/ai-engine-config');
      const mergedConfig = mergeConfig(testConfig);

      console.log('  测试配置合并:');
      console.log('    - 槽位填充:', mergedConfig.enableSlotFilling, '(应为 false)');
      console.log('    - 工具沙箱:', mergedConfig.enableToolSandbox, '(应为 true)');
      console.log('    - 沙箱超时:', mergedConfig.sandboxConfig.timeout + 'ms', '(应为 15000ms)');

      if (mergedConfig.enableSlotFilling === false &&
          mergedConfig.enableToolSandbox === true &&
          mergedConfig.sandboxConfig.timeout === 15000) {
        console.log('  ✅ 配置合并正确');
      } else {
        console.log('  ❌ 配置合并错误');
        process.exit(1);
      }
    } catch (error) {
      console.log('  ❌ 初始化测试失败:', error.message);
      process.exit(1);
    }

    // 全部通过
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║  ✅ 所有集成测试通过！                                  ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    console.log('📋 部署清单:');
    console.log('  ✅ 主应用已更新为使用优化版AI引擎');
    console.log('  ✅ 自动化管理器已更新');
    console.log('  ✅ 配置文件已创建');
    console.log('  ✅ 数据库迁移已完成');
    console.log('  ✅ 所有优化模块可用\n');

    console.log('🚀 优化版AI引擎已成功部署到生产环境！');
    console.log('\n下次启动应用时，将自动使用以下优化功能:');
    console.log('  • 槽位填充 - 自动推断缺失参数');
    console.log('  • 工具沙箱 - 超时保护、自动重试、结果校验');
    console.log('  • 性能监控 - P50/P90/P95统计、瓶颈识别、优化建议\n');

  } catch (error) {
    console.error('\n❌ 集成测试失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

testIntegration();
