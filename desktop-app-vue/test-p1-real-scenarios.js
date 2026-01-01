/**
 * P1实际场景测试
 * 使用真实的LLM服务、数据库和工具进行端到端测试
 *
 * 测试场景:
 * 1. 简单任务 - 创建单个文件
 * 2. 复合任务 - 创建网站（多意图）
 * 3. 需要槽位填充 - 缺失参数的任务
 * 4. 复杂任务 - 数据分析（分层规划）
 * 5. 容错测试 - 可能失败的任务（自我修正）
 *
 * 运行: node test-p1-real-scenarios.js
 */

const path = require('path');
const fs = require('fs');

// 测试结果收集
const testResults = {
  scenarios: [],
  performance: {},
  p1Stats: null,
  startTime: Date.now(),
  endTime: null
};

// ========================================
// 工具函数
// ========================================

function log(level, message, data = null) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const prefix = {
    info: '📋',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    data: '📊'
  }[level] || 'ℹ️';

  console.log(`${prefix} [${timestamp}] ${message}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPercentage(value) {
  return `${(value * 100).toFixed(1)}%`;
}

// ========================================
// 测试场景定义
// ========================================

const scenarios = [
  {
    id: 'scenario_1',
    name: '简单任务 - 创建Markdown文件',
    description: '测试单意图识别和基本执行',
    userInput: '创建一个README.md文件，内容是项目介绍',
    context: {
      projectPath: path.join(__dirname, 'test-output')
    },
    expectedIntentCount: 1,
    expectedSuccess: true,
    timeout: 30000
  },
  {
    id: 'scenario_2',
    name: '复合任务 - 创建博客网站',
    description: '测试多意图识别和依赖处理',
    userInput: '创建一个博客网站，包含首页和样式文件',
    context: {
      projectPath: path.join(__dirname, 'test-output/blog')
    },
    expectedIntentCount: 2, // CREATE_WEBSITE 可能被拆分
    expectedSuccess: true,
    timeout: 60000
  },
  {
    id: 'scenario_3',
    name: '需要槽位填充 - 创建Word文档',
    description: '测试槽位填充和参数推断',
    userInput: '生成一个工作报告',
    context: {
      projectPath: path.join(__dirname, 'test-output')
    },
    expectedIntentCount: 1,
    expectedSuccess: true,
    timeout: 45000
  },
  {
    id: 'scenario_4',
    name: '复杂任务 - 数据分析',
    description: '测试分层任务规划',
    userInput: '分析项目中的所有JavaScript文件，统计函数数量',
    context: {
      projectPath: path.join(__dirname, 'src')
    },
    expectedIntentCount: 1,
    expectedSuccess: true,
    timeout: 60000
  },
  {
    id: 'scenario_5',
    name: '容错测试 - 可能失败的任务',
    description: '测试自我修正循环',
    userInput: '读取不存在的文件 /nonexistent/file.txt',
    context: {
      projectPath: path.join(__dirname, 'test-output')
    },
    expectedIntentCount: 1,
    expectedSuccess: false, // 预期失败
    timeout: 45000
  }
];

// ========================================
// 测试执行器
// ========================================

async function runScenario(scenario, aiEngine) {
  log('info', `\n${'='.repeat(70)}`);
  log('info', `场景: ${scenario.name}`);
  log('info', `描述: ${scenario.description}`);
  log('info', `输入: "${scenario.userInput}"`);
  log('info', `${'='.repeat(70)}\n`);

  const scenarioResult = {
    id: scenario.id,
    name: scenario.name,
    userInput: scenario.userInput,
    startTime: Date.now(),
    endTime: null,
    duration: 0,
    success: false,
    error: null,
    result: null,
    intentCount: 0,
    isMultiIntent: false,
    stepsExecuted: 0,
    performance: {}
  };

  try {
    // 设置超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('测试超时')), scenario.timeout);
    });

    // 执行场景
    const resultPromise = aiEngine.processUserInput(
      scenario.userInput,
      scenario.context,
      (step) => {
        if (step.status === 'running') {
          log('info', `  ▶ ${step.name}`);
        } else if (step.status === 'completed') {
          log('success', `  ✓ ${step.name} (${formatDuration(step.duration)})`);
        } else if (step.status === 'failed') {
          log('error', `  ✗ ${step.name}: ${step.error}`);
        }
      },
      null // 不需要用户交互
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);

    scenarioResult.endTime = Date.now();
    scenarioResult.duration = scenarioResult.endTime - scenarioResult.startTime;
    scenarioResult.success = result.success;
    scenarioResult.result = result;
    scenarioResult.intentCount = result.intents?.length || 0;
    scenarioResult.isMultiIntent = result.isMultiIntent || false;
    scenarioResult.stepsExecuted = result.results?.length || 0;
    scenarioResult.performance = result.performance || {};

    // 验证预期
    const assertions = [];

    // 检查意图数量
    if (scenario.expectedIntentCount) {
      const intentMatch = scenarioResult.intentCount >= scenario.expectedIntentCount;
      assertions.push({
        name: '意图数量',
        expected: `>= ${scenario.expectedIntentCount}`,
        actual: scenarioResult.intentCount,
        passed: intentMatch
      });
    }

    // 检查成功状态
    const successMatch = scenarioResult.success === scenario.expectedSuccess;
    assertions.push({
      name: '执行结果',
      expected: scenario.expectedSuccess ? '成功' : '失败',
      actual: scenarioResult.success ? '成功' : '失败',
      passed: successMatch
    });

    scenarioResult.assertions = assertions;
    const allAssertionsPassed = assertions.every(a => a.passed);

    // 输出结果
    log('info', '\n--- 场景结果 ---');
    log('data', `总耗时: ${formatDuration(scenarioResult.duration)}`);
    log('data', `意图数量: ${scenarioResult.intentCount} (${scenarioResult.isMultiIntent ? '多意图' : '单意图'})`);
    log('data', `执行步骤: ${scenarioResult.stepsExecuted}`);
    log('data', `执行结果: ${scenarioResult.success ? '✅ 成功' : '❌ 失败'}`);

    if (scenarioResult.performance.intent_recognition) {
      log('data', `意图识别耗时: ${formatDuration(scenarioResult.performance.intent_recognition)}`);
    }

    log('info', '\n--- 断言检查 ---');
    assertions.forEach(assertion => {
      const status = assertion.passed ? '✅' : '❌';
      log('data', `${status} ${assertion.name}: 期望=${assertion.expected}, 实际=${assertion.actual}`);
    });

    if (allAssertionsPassed) {
      log('success', `\n✅ 场景 "${scenario.name}" 通过\n`);
    } else {
      log('error', `\n❌ 场景 "${scenario.name}" 失败\n`);
    }

    return scenarioResult;

  } catch (error) {
    scenarioResult.endTime = Date.now();
    scenarioResult.duration = scenarioResult.endTime - scenarioResult.startTime;
    scenarioResult.error = error.message;
    scenarioResult.success = false;

    log('error', `场景执行失败: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }

    return scenarioResult;
  }
}

// ========================================
// 主测试流程
// ========================================

async function runRealScenarios() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      P1实际场景测试 - AI引擎P1版本                      ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  try {
    // ========================================
    // 1. 环境检查
    // ========================================
    log('info', '步骤1: 检查环境...');

    // 检查数据库迁移
    const dbPath = path.join(__dirname, '../data/chainlesschain.db');
    if (!fs.existsSync(dbPath)) {
      log('error', '数据库文件不存在，请先运行: node run-migration-p1.js');
      process.exit(1);
    }
    log('success', '数据库文件存在');

    // 创建测试输出目录
    const testOutputDir = path.join(__dirname, 'test-output');
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
      log('success', `创建测试输出目录: ${testOutputDir}`);
    }

    // ========================================
    // 2. 初始化数据库和LLM
    // ========================================
    log('info', '\n步骤2: 初始化数据库和LLM...');

    // 初始化数据库
    const DatabaseManager = require('./src/main/database');
    const dbManager = new DatabaseManager(dbPath, {
      password: '123456',
      encryptionEnabled: false // 测试环境不使用加密
    });
    await dbManager.initialize();
    DatabaseManager.setDatabase(dbManager);
    log('success', '数据库已初始化');

    // 初始化LLM管理器
    const { getLLMManager } = require('./src/main/llm/llm-manager');
    const llmManager = getLLMManager();

    if (!llmManager.isInitialized) {
      await llmManager.initialize();
      log('success', 'LLM管理器已初始化');
    }

    // ========================================
    // 3. 初始化AI引擎
    // ========================================
    log('info', '\n步骤3: 初始化AI引擎P1...');

    const { getAIEngineManagerP1 } = require('./src/main/ai-engine/ai-engine-manager-p1');
    const aiEngine = getAIEngineManagerP1();

    await aiEngine.initialize({
      // P1优化全开
      enableMultiIntent: true,
      enableDynamicFewShot: true,
      enableHierarchicalPlanning: true,
      enableCheckpointValidation: true,
      enableSelfCorrection: true,

      // P0优化
      enableSlotFilling: true,
      enableToolSandbox: true,
      enablePerformanceMonitor: true,

      // 调整超时（实际场景可能更慢）
      sandboxConfig: {
        timeout: 60000,
        retries: 2
      }
    });

    aiEngine.setUserId('test_user_real_scenarios');
    log('success', 'AI引擎P1初始化完成');

    // ========================================
    // 4. 运行测试场景
    // ========================================
    log('info', `\n步骤4: 运行 ${scenarios.length} 个测试场景...\n`);

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      log('info', `\n[${i + 1}/${scenarios.length}] 运行场景: ${scenario.name}`);

      const result = await runScenario(scenario, aiEngine);
      testResults.scenarios.push(result);

      // 短暂延迟，避免资源争用
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // ========================================
    // 5. 获取P1统计数据
    // ========================================
    log('info', '\n步骤5: 获取P1优化统计...');

    try {
      const p1Stats = await aiEngine.getP1OptimizationStats();
      testResults.p1Stats = p1Stats;
      log('success', 'P1统计数据已获取');
    } catch (error) {
      log('warning', `获取P1统计失败: ${error.message}`);
    }

    // ========================================
    // 6. 获取性能报告
    // ========================================
    log('info', '\n步骤6: 获取性能报告...');

    try {
      const perfReport = await aiEngine.getPerformanceReport(24 * 60 * 60 * 1000); // 24小时
      testResults.performance = perfReport;
      log('success', '性能报告已获取');
    } catch (error) {
      log('warning', `获取性能报告失败: ${error.message}`);
    }

    testResults.endTime = Date.now();

    // ========================================
    // 7. 生成测试报告
    // ========================================
    log('info', '\n步骤7: 生成测试报告...\n');

    generateTestReport(testResults);

    // 保存详细报告到文件
    const reportPath = path.join(testOutputDir, 'p1-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(testResults, null, 2), 'utf-8');
    log('success', `详细报告已保存: ${reportPath}`);

    // ========================================
    // 8. 退出
    // ========================================
    const passedScenarios = testResults.scenarios.filter(s => {
      return s.assertions?.every(a => a.passed);
    }).length;

    const allPassed = passedScenarios === scenarios.length;

    if (allPassed) {
      log('success', '\n🎉 所有场景测试通过！');
      process.exit(0);
    } else {
      log('error', `\n⚠️ ${scenarios.length - passedScenarios} 个场景失败`);
      process.exit(1);
    }

  } catch (error) {
    log('error', '测试执行失败:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// ========================================
// 报告生成
// ========================================

function generateTestReport(results) {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                   测试报告                               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const totalDuration = results.endTime - results.startTime;
  const passedScenarios = results.scenarios.filter(s => {
    return s.assertions?.every(a => a.passed);
  });
  const failedScenarios = results.scenarios.filter(s => {
    return !s.assertions?.every(a => a.passed);
  });

  // 概览
  console.log('📊 测试概览');
  console.log(`  总场景数: ${results.scenarios.length}`);
  console.log(`  通过: ${passedScenarios.length} ✅`);
  console.log(`  失败: ${failedScenarios.length} ❌`);
  console.log(`  成功率: ${formatPercentage(passedScenarios.length / results.scenarios.length)}`);
  console.log(`  总耗时: ${formatDuration(totalDuration)}\n`);

  // 场景详情
  console.log('📋 场景详情');
  results.scenarios.forEach((scenario, index) => {
    const passed = scenario.assertions?.every(a => a.passed);
    const status = passed ? '✅' : '❌';
    console.log(`  ${status} [${index + 1}] ${scenario.name}`);
    console.log(`      输入: "${scenario.userInput}"`);
    console.log(`      耗时: ${formatDuration(scenario.duration)}`);
    console.log(`      意图数: ${scenario.intentCount} (${scenario.isMultiIntent ? '多' : '单'})`);
    console.log(`      步骤数: ${scenario.stepsExecuted}`);
    console.log(`      结果: ${scenario.success ? '成功' : '失败'}`);
    if (scenario.error) {
      console.log(`      错误: ${scenario.error}`);
    }
    console.log('');
  });

  // 性能统计
  console.log('⚡ 性能统计');
  const durations = results.scenarios.map(s => s.duration).filter(d => d > 0);
  if (durations.length > 0) {
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);

    console.log(`  平均耗时: ${formatDuration(avgDuration)}`);
    console.log(`  最快: ${formatDuration(minDuration)}`);
    console.log(`  最慢: ${formatDuration(maxDuration)}\n`);
  }

  // P1优化统计
  if (results.p1Stats?.summary) {
    console.log('🚀 P1优化效果');
    results.p1Stats.summary.forEach(stat => {
      console.log(`  ${stat.feature}:`);
      console.log(`    使用次数: ${stat.total_uses}`);
      console.log(`    激活次数: ${stat.feature_activated}`);
      console.log(`    成功率: ${formatPercentage(stat.success_rate)}`);
    });
    console.log('');
  }

  // 多意图统计
  const multiIntentScenarios = results.scenarios.filter(s => s.isMultiIntent);
  if (multiIntentScenarios.length > 0) {
    console.log('🔀 多意图识别');
    console.log(`  识别到多意图的场景: ${multiIntentScenarios.length}/${results.scenarios.length}`);
    console.log(`  平均意图数: ${(multiIntentScenarios.reduce((sum, s) => sum + s.intentCount, 0) / multiIntentScenarios.length).toFixed(1)}\n`);
  }

  // 失败分析
  if (failedScenarios.length > 0) {
    console.log('⚠️ 失败分析');
    failedScenarios.forEach(scenario => {
      console.log(`  ❌ ${scenario.name}`);
      if (scenario.error) {
        console.log(`     错误: ${scenario.error}`);
      }
      if (scenario.assertions) {
        const failedAssertions = scenario.assertions.filter(a => !a.passed);
        failedAssertions.forEach(assertion => {
          console.log(`     ✗ ${assertion.name}: 期望=${assertion.expected}, 实际=${assertion.actual}`);
        });
      }
    });
    console.log('');
  }

  // 建议
  console.log('💡 建议');
  if (passedScenarios.length === results.scenarios.length) {
    console.log('  ✅ 所有场景通过，P1集成工作正常！');
    console.log('  ✅ 可以部署到生产环境');
  } else {
    console.log('  ⚠️ 部分场景失败，建议检查：');
    console.log('    1. LLM服务是否正常运行');
    console.log('    2. 数据库迁移是否完成');
    console.log('    3. 配置参数是否合理');
  }
  console.log('');
}

// ========================================
// 运行测试
// ========================================

runRealScenarios().catch(error => {
  log('error', '测试异常终止:', error);
  process.exit(1);
});
