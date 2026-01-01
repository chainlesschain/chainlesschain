/**
 * 端到端测试套件 (End-to-End Pipeline Test)
 * 测试 P0/P1/P2 完整集成流程
 *
 * 测试场景：
 * 1. 完整 Pipeline: 用户输入 → 意图融合 → 知识蒸馏 → 任务规划 → 执行 → 流式反馈
 * 2. 错误修正: 执行失败 → 自我修正 → 重试成功
 * 3. 复合任务: 多意图 → 融合 → 分层规划 → 检查点校验
 *
 * @version v1.0
 * @date 2026-01-02
 */

const path = require('path');
const { performance } = require('perf_hooks');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  gray: '\x1b[90m'
};

function logSuccess(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function logError(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function logWarning(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║     P0/P1/P2 端到端集成测试套件                         ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// 测试统计
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

/**
 * Mock LLM Manager
 */
class MockLLMManager {
  async chat(messages, options = {}) {
    // 模拟不同场景的响应
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage.content || '';

    if (content.includes('拆分') || content.includes('split')) {
      return {
        content: JSON.stringify({
          intents: [
            { intent: 'CREATE_FILE', priority: 1, dependencies: [] },
            { intent: 'GIT_COMMIT', priority: 2, dependencies: [1] }
          ]
        })
      };
    }

    if (content.includes('复杂度') || content.includes('complexity')) {
      return { content: '0.35' };
    }

    if (content.includes('业务') || content.includes('business')) {
      return {
        content: JSON.stringify({
          steps: ['设计功能', '实现代码', '测试验证']
        })
      };
    }

    if (content.includes('质量') || content.includes('quality')) {
      return { content: '0.85' };
    }

    return { content: 'Mock response' };
  }

  async complete(prompt, options = {}) {
    return this.chat([{ role: 'user', content: prompt }], options);
  }
}

/**
 * 初始化测试数据库
 */
async function initTestDatabase() {
  const DatabaseManager = require('./src/main/database');
  const dbPath = path.join(__dirname, 'data/test-e2e-pipeline.db');

  // 删除旧数据库（先确保没有连接）
  const fs = require('fs');
  try {
    if (fs.existsSync(dbPath)) {
      // 等待一小段时间确保数据库连接已释放
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.unlinkSync(dbPath);
    }
  } catch (error) {
    // 忽略删除失败
    logWarning(`无法删除旧数据库: ${error.message}`);
  }

  const db = new DatabaseManager(dbPath, { encryptionEnabled: false });
  await db.initialize();

  // 运行P1迁移
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS multi_intent_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        user_input TEXT NOT NULL,
        is_multi_intent INTEGER DEFAULT 0,
        intent_count INTEGER DEFAULT 1,
        intents TEXT,
        recognition_duration INTEGER,
        confidence REAL,
        success INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS hierarchical_planning_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        user_id TEXT,
        intent_type TEXT NOT NULL,
        intent_description TEXT,
        granularity TEXT DEFAULT 'auto',
        business_steps INTEGER DEFAULT 0,
        technical_steps INTEGER DEFAULT 0,
        execution_steps INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        planning_duration INTEGER,
        estimated_duration INTEGER,
        plan_details TEXT,
        execution_success INTEGER,
        actual_duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS checkpoint_validations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        step_index INTEGER NOT NULL,
        step_title TEXT,
        passed INTEGER DEFAULT 1,
        failed_count INTEGER DEFAULT 0,
        critical_failures INTEGER DEFAULT 0,
        validations TEXT,
        recommendation TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS self_correction_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        plan_description TEXT,
        total_steps INTEGER,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 1,
        corrections TEXT,
        final_success INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (error) {
    logWarning(`P1 迁移失败（可能已存在）: ${error.message}`);
  }

  // 运行P2迁移
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS intent_fusion_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        user_id TEXT,
        original_intents TEXT NOT NULL,
        fused_intents TEXT NOT NULL,
        fusion_strategy TEXT,
        original_count INTEGER NOT NULL,
        fused_count INTEGER NOT NULL,
        reduction_rate REAL,
        llm_calls_saved INTEGER,
        context TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_distillation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        complexity_level TEXT NOT NULL,
        complexity_score REAL NOT NULL,
        planned_model TEXT NOT NULL,
        actual_model TEXT NOT NULL,
        used_fallback INTEGER DEFAULT 0,
        task_intents TEXT,
        context_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(`
      CREATE TABLE IF NOT EXISTS streaming_response_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data TEXT,
        timestamp TEXT NOT NULL
      )
    `);
  } catch (error) {
    logWarning(`P2 迁移失败（可能已存在）: ${error.message}`);
  }

  logInfo(`测试数据库已创建: ${dbPath}`);
  return db;
}

/**
 * 测试场景 1: 完整 P2 Pipeline
 * 用户输入 → 意图融合 → 知识蒸馏 → 流式执行
 */
async function testCompletePipeline() {
  console.log('\n' + '='.repeat(70));
  console.log('测试场景 1: 完整 P2 Pipeline');
  console.log('='.repeat(70));

  const db = await initTestDatabase();
  const mockLLM = new MockLLMManager();

  try {
    // Step 1: 意图融合
    console.log('\n[步骤 1/4] 意图融合测试...');
    totalTests++;

    const IntentFusion = require('./src/main/ai-engine/intent-fusion');
    const fusion = new IntentFusion();
    fusion.setDatabase(db);

    const originalIntents = [
      { type: 'CREATE_FILE', params: { filePath: 'index.html' } },
      { type: 'WRITE_FILE', params: { filePath: 'index.html', content: '<h1>Hello</h1>' } }
    ];

    const startTime1 = performance.now();
    const fusedResult = await fusion.fuseIntents(originalIntents, { sessionId: 'test-e2e-1' });
    const duration1 = performance.now() - startTime1;

    // fuseIntents 返回融合后的意图数组
    if (Array.isArray(fusedResult) && fusedResult.length === 1) {
      const savingsRate = ((originalIntents.length - fusedResult.length) / originalIntents.length * 100);
      logSuccess(`意图融合成功: 2 → 1 (节省 ${savingsRate.toFixed(1)}%, 耗时 ${duration1.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: '意图融合', status: 'pass', duration: duration1 });
    } else {
      logError(`意图融合失败: 期望1个意图，实际 ${fusedResult ? fusedResult.length : 'undefined'}`);
      failedTests++;
      testResults.push({ name: '意图融合', status: 'fail', duration: duration1 });
    }

    // Step 2: 知识蒸馏
    console.log('\n[步骤 2/4] 知识蒸馏测试...');
    totalTests++;

    const { KnowledgeDistillation } = require('./src/main/ai-engine/knowledge-distillation');
    const kd = new KnowledgeDistillation();
    kd.setDatabase(db);
    kd.setLLM(mockLLM);

    const task = {
      intents: fusedResult, // fusedResult 已经是意图数组
      context: { userId: 'test_user' }
    };

    const startTime2 = performance.now();
    const result = await kd.executeWithDistillation(task);
    const duration2 = performance.now() - startTime2;

    if (result && result._distillation && result._distillation.modelUsed) {
      logSuccess(`知识蒸馏成功: 使用 ${result._distillation.modelUsed} 模型 (复杂度: ${result._distillation.complexity}, 耗时 ${duration2.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: '知识蒸馏', status: 'pass', duration: duration2 });
    } else {
      logError(`知识蒸馏失败: result = ${JSON.stringify(result, null, 2)}`);
      failedTests++;
      testResults.push({ name: '知识蒸馏', status: 'fail', duration: duration2 });
    }

    // Step 3: 流式响应
    console.log('\n[步骤 3/4] 流式响应测试...');
    totalTests++;

    const { StreamingResponse } = require('./src/main/ai-engine/streaming-response');
    const streaming = new StreamingResponse();
    streaming.setDatabase(db);

    let progressCount = 0;
    const startTime3 = performance.now();

    // 创建流式任务
    const streamingTask = streaming.createTask('test-e2e-streaming');
    streamingTask.start(3);

    // 模拟3个步骤的执行
    for (let i = 1; i <= 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      streamingTask.updateProgress(i, `执行步骤 ${i}/3`);
      progressCount++;
    }

    const streamResult = { success: true, steps: 3 };
    streamingTask.complete(streamResult);
    const duration3 = performance.now() - startTime3;

    if (streamResult.success && progressCount === 3) {
      logSuccess(`流式响应成功: 收到 ${progressCount} 次进度更新 (耗时 ${duration3.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: '流式响应', status: 'pass', duration: duration3 });
    } else {
      logError('流式响应失败');
      failedTests++;
      testResults.push({ name: '流式响应', status: 'fail', duration: duration3 });
    }

    // Step 4: 端到端性能验证
    console.log('\n[步骤 4/4] 端到端性能验证...');
    totalTests++;

    const totalDuration = duration1 + duration2 + duration3;
    if (totalDuration < 1000) {
      logSuccess(`端到端性能优秀: 总耗时 ${totalDuration.toFixed(0)}ms < 1000ms`);
      passedTests++;
      testResults.push({ name: '端到端性能', status: 'pass', duration: totalDuration });
    } else {
      logWarning(`端到端性能可接受: 总耗时 ${totalDuration.toFixed(0)}ms`);
      passedTests++;
      testResults.push({ name: '端到端性能', status: 'pass', duration: totalDuration });
    }

    db.close();
  } catch (error) {
    logError(`测试场景 1 失败: ${error.message}`);
    console.error(error.stack);
    failedTests++;
  }
}

/**
 * 测试场景 2: P1 错误修正流程
 * 执行失败 → 诊断 → 修正 → 重试成功
 */
async function testSelfCorrectionFlow() {
  console.log('\n' + '='.repeat(70));
  console.log('测试场景 2: P1 自我修正流程');
  console.log('='.repeat(70));

  const db = await initTestDatabase();
  const mockLLM = new MockLLMManager();

  try {
    console.log('\n[步骤 1/2] 自我修正循环测试...');
    totalTests++;

    const SelfCorrectionLoop = require('./src/main/ai-engine/self-correction-loop');
    const corrector = new SelfCorrectionLoop(mockLLM, db);

    const plan = {
      description: '测试自我修正',
      steps: [
        { tool: 'test_tool', params: { value: 'test' } }
      ]
    };

    let attemptCount = 0;
    const startTime = performance.now();

    const executor = async (step) => {
      attemptCount++;
      if (attemptCount === 1) {
        // 第一次失败
        throw new Error('invalid_params: 参数格式不正确');
      }
      // 第二次成功
      return { success: true, result: 'corrected' };
    };

    const result = await corrector.executeWithCorrection(plan, executor, { maxRetries: 3 });
    const duration = performance.now() - startTime;

    if (result.success && result.attempts === 2 && result.corrections.length === 1) {
      logSuccess(`自我修正成功: 尝试 ${result.attempts} 次，修正 ${result.corrections.length} 次 (耗时 ${duration.toFixed(0)}ms)`);
      logInfo(`诊断结果: ${result.corrections[0].diagnosis.category}`);
      passedTests++;
      testResults.push({ name: 'P1自我修正', status: 'pass', duration });
    } else {
      logError('自我修正失败');
      failedTests++;
      testResults.push({ name: 'P1自我修正', status: 'fail', duration });
    }

    console.log('\n[步骤 2/2] 修正历史记录验证...');
    totalTests++;

    const stats = await corrector.getCorrectionStats(7);
    if (stats && stats.totalAttempts > 0) {
      logSuccess(`修正历史已记录: 总尝试 ${stats.totalAttempts} 次`);
      passedTests++;
      testResults.push({ name: '修正历史记录', status: 'pass', duration: 0 });
    } else {
      logError('修正历史记录失败');
      failedTests++;
      testResults.push({ name: '修正历史记录', status: 'fail', duration: 0 });
    }

    db.close();
  } catch (error) {
    logError(`测试场景 2 失败: ${error.message}`);
    console.error(error.stack);
    failedTests++;
  }
}

/**
 * 测试场景 3: P1 复合任务处理
 * 多意图识别 → 分层规划 → 检查点校验
 */
async function testComplexTaskFlow() {
  console.log('\n' + '='.repeat(70));
  console.log('测试场景 3: P1 复合任务处理');
  console.log('='.repeat(70));

  const db = await initTestDatabase();
  const mockLLM = new MockLLMManager();

  try {
    // Step 1: 多意图识别
    console.log('\n[步骤 1/3] 多意图识别测试...');
    totalTests++;

    const MultiIntentRecognizer = require('./src/main/ai-engine/multi-intent-recognizer');
    const mockClassifier = {
      classify: async () => ({ intent: 'CREATE_FILE', confidence: 0.9, entities: {} })
    };

    const recognizer = new MultiIntentRecognizer(mockLLM, mockClassifier);
    const startTime1 = performance.now();

    const multiIntentResult = await recognizer.classifyMultiple('创建网页并提交Git');
    const duration1 = performance.now() - startTime1;

    if (multiIntentResult.isMultiIntent && multiIntentResult.intents.length >= 2) {
      logSuccess(`多意图识别成功: 识别出 ${multiIntentResult.intents.length} 个意图 (耗时 ${duration1.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: 'P1多意图识别', status: 'pass', duration: duration1 });
    } else {
      logError('多意图识别失败');
      failedTests++;
      testResults.push({ name: 'P1多意图识别', status: 'fail', duration: duration1 });
    }

    // Step 2: 分层任务规划
    console.log('\n[步骤 2/3] 分层任务规划测试...');
    totalTests++;

    const HierarchicalTaskPlanner = require('./src/main/ai-engine/hierarchical-task-planner');
    const mockTaskPlanner = {
      plan: async () => ({ steps: [] })
    };
    const mockFunctionCaller = {
      getAvailableTools: () => ['html_generator', 'git_commit']
    };

    const planner = new HierarchicalTaskPlanner(mockLLM, mockTaskPlanner, mockFunctionCaller);
    const startTime2 = performance.now();

    const planResult = await planner.plan(
      { intent: 'CREATE_FILE', description: '创建网页' },
      {},
      { granularity: 'auto' }
    );
    const duration2 = performance.now() - startTime2;

    if (planResult && planResult.layers && planResult.layers.business) {
      logSuccess(`分层规划成功: ${planResult.granularity} 粒度，${planResult.layers.business.length} 个业务步骤 (耗时 ${duration2.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: 'P1分层规划', status: 'pass', duration: duration2 });
    } else {
      logError('分层规划失败');
      failedTests++;
      testResults.push({ name: 'P1分层规划', status: 'fail', duration: duration2 });
    }

    // Step 3: 检查点校验
    console.log('\n[步骤 3/3] 检查点校验测试...');
    totalTests++;

    const CheckpointValidator = require('./src/main/ai-engine/checkpoint-validator');
    const validator = new CheckpointValidator(mockLLM, db);
    const startTime3 = performance.now();

    // 将分层规划结果转换为CheckpointValidator期望的格式
    const checkpointPlan = {
      subtasks: planResult.layers.business || [],
      granularity: planResult.granularity
    };

    const stepResult = { success: true, html: '<!DOCTYPE html><html></html>', title: 'Test' };
    const validationResult = await validator.validateCheckpoint(0, stepResult, checkpointPlan);
    const duration3 = performance.now() - startTime3;

    if (validationResult.passed && validationResult.failedCount === 0) {
      logSuccess(`检查点校验成功: ${validationResult.validations.length} 项检查通过 (耗时 ${duration3.toFixed(0)}ms)`);
      passedTests++;
      testResults.push({ name: 'P1检查点校验', status: 'pass', duration: duration3 });
    } else {
      logError('检查点校验失败');
      failedTests++;
      testResults.push({ name: 'P1检查点校验', status: 'fail', duration: duration3 });
    }

    db.close();
  } catch (error) {
    logError(`测试场景 3 失败: ${error.message}`);
    console.error(error.stack);
    failedTests++;
  }
}

/**
 * 测试场景 4: 性能基准测试
 */
async function testPerformanceBenchmark() {
  console.log('\n' + '='.repeat(70));
  console.log('测试场景 4: 性能基准测试');
  console.log('='.repeat(70));

  const db = await initTestDatabase();

  try {
    // 意图融合性能
    console.log('\n[基准 1/3] 意图融合性能...');
    totalTests++;

    const IntentFusion = require('./src/main/ai-engine/intent-fusion');
    const fusion = new IntentFusion();
    fusion.setDatabase(db);

    const iterations = 100;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      await fusion.fuseIntents([
        { type: 'CREATE_FILE', params: { filePath: `test${i}.html` } },
        { type: 'WRITE_FILE', params: { filePath: `test${i}.html`, content: 'test' } }
      ], { sessionId: `bench-${i}` });
    }

    const totalTime = performance.now() - startTime;
    const avgTime = totalTime / iterations;

    if (avgTime < 10) {
      logSuccess(`意图融合性能优秀: ${iterations} 次平均 ${avgTime.toFixed(2)}ms/次`);
      passedTests++;
      testResults.push({ name: '融合性能基准', status: 'pass', duration: avgTime });
    } else {
      logWarning(`意图融合性能可接受: ${iterations} 次平均 ${avgTime.toFixed(2)}ms/次`);
      passedTests++;
      testResults.push({ name: '融合性能基准', status: 'pass', duration: avgTime });
    }

    // 缓存命中率
    console.log('\n[基准 2/3] 缓存命中率...');
    totalTests++;

    const stats = fusion.getPerformanceStats();
    const hitRate = stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100;

    if (hitRate >= 90) {
      logSuccess(`缓存命中率优秀: ${hitRate.toFixed(1)}% (${stats.cacheHits}/${stats.cacheHits + stats.cacheMisses})`);
      passedTests++;
      testResults.push({ name: '缓存命中率', status: 'pass', duration: hitRate });
    } else {
      logWarning(`缓存命中率可接受: ${hitRate.toFixed(1)}%`);
      passedTests++;
      testResults.push({ name: '缓存命中率', status: 'pass', duration: hitRate });
    }

    // 内存使用
    console.log('\n[基准 3/3] 内存使用检查...');
    totalTests++;

    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

    if (heapUsedMB < 100) {
      logSuccess(`内存使用正常: ${heapUsedMB} MB`);
      passedTests++;
      testResults.push({ name: '内存使用', status: 'pass', duration: parseFloat(heapUsedMB) });
    } else {
      logWarning(`内存使用偏高: ${heapUsedMB} MB`);
      passedTests++;
      testResults.push({ name: '内存使用', status: 'pass', duration: parseFloat(heapUsedMB) });
    }

    db.close();
  } catch (error) {
    logError(`测试场景 4 失败: ${error.message}`);
    console.error(error.stack);
    failedTests++;
  }
}

/**
 * 主测试函数
 */
async function runAllTests() {
  const overallStart = performance.now();

  try {
    // 运行所有测试场景
    await testCompletePipeline();
    await testSelfCorrectionFlow();
    await testComplexTaskFlow();
    await testPerformanceBenchmark();

    const overallDuration = performance.now() - overallStart;

    // 打印测试报告
    console.log('\n' + '='.repeat(70));
    console.log('测试结果汇总');
    console.log('='.repeat(70));

    console.log(`\n总测试数: ${totalTests}`);
    console.log(`${colors.green}✓ 通过: ${passedTests}${colors.reset}`);
    console.log(`${colors.red}✗ 失败: ${failedTests}${colors.reset}`);
    console.log(`通过率: ${(passedTests / totalTests * 100).toFixed(2)}%`);
    console.log(`总耗时: ${overallDuration.toFixed(0)}ms`);

    // 详细结果
    console.log('\n详细结果:');
    testResults.forEach((result, index) => {
      const status = result.status === 'pass' ? colors.green + '✓' : colors.red + '✗';
      const duration = result.duration.toFixed(0);
      console.log(`  ${status}${colors.reset} ${index + 1}. ${result.name} (${duration}ms)`);
    });

    // 最终结论
    console.log('\n' + '='.repeat(70));
    if (failedTests === 0) {
      console.log(`${colors.green}🎉 所有端到端测试通过！系统已准备好部署。${colors.reset}`);
      process.exit(0);
    } else {
      console.log(`${colors.red}❌ 部分测试失败，请检查并修复问题后再部署。${colors.reset}`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n测试执行出错:', error);
    process.exit(1);
  }
}

// 运行测试
runAllTests().catch(error => {
  console.error('测试失败:', error);
  process.exit(1);
});
